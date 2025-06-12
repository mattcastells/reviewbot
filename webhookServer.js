require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { reviewDiffInline } = require('./reviewBot');

const app = express();
app.use(express.json());

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

app.post('/webhook', async (req, res) => {
  const event = req.body;

  if (event.object_kind !== 'merge_request') {
    return res.status(200).send("Evento no soportado");
  }

  const mr = event.object_attributes;
  const projectId = event.project.id;
  const mrIid = mr.iid;

  console.log(`📦 Merge Request recibido: !${mrIid} en ${event.project.name}`);
  console.log("📄 Enviando diff al LLM...");

  try {
    const diffUrl = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/changes`;
    const diffResp = await fetch(diffUrl, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
    });
    
    if (!diffResp.ok) {
      throw new Error(`Error obteniendo diff: ${diffResp.status} ${diffResp.statusText}`);
    }
    
    const diffData = await diffResp.json();

    // 🔧 Mejora: Crear un mapa de archivos con líneas modificadas
    const fileLineMap = createFileLineMap(diffData.changes);
    
    const combinedDiff = diffData.changes.map(change => {
      return `diff --git a/${change.old_path} b/${change.new_path}\n${change.diff}`;
    }).join('\n');

    const suggestions = await reviewDiffInline(combinedDiff);

    console.log("🔎 Sugerencias generadas:", suggestions);

    const { base_sha, head_sha, start_sha } = diffData.diff_refs;

    let successCount = 0;
    let failedComments = [];
    
    for (const suggestion of suggestions) {
      try {
        // 🔧 Validar que la línea existe en el diff
        if (!validateLineInDiff(suggestion, fileLineMap)) {
          console.warn(`⚠️ Línea ${suggestion.line} no encontrada en ${suggestion.file}, saltando...`);
          continue;
        }
        
        const lineCode = getLineCode(suggestion, fileLineMap);
        if (!lineCode) {
          console.warn(`⚠️ No se pudo generar line_code para ${suggestion.file}:${suggestion.line}, saltando...`);
          failedComments.push({
            file: suggestion.file,
            line: suggestion.line,
            comment: suggestion.comment
          });
          continue;
        }
        
        await postInlineComment(projectId, mrIid, suggestion, base_sha, head_sha, start_sha, lineCode);
        successCount++;
      } catch (err) {
        console.error(`❌ Error publicando comentario inline en ${suggestion.file}:${suggestion.line}:`, err.message || err);
        
        // 🔧 Guardar para el resumen en lugar de publicar individual
        failedComments.push({
          file: suggestion.file,
          line: suggestion.line,
          comment: suggestion.comment
        });
      }
    }

    // 🔧 Crear un solo comentario resumen
    let summaryText = "🤖 **Revisión automática del LLM**\n\n";
    
    if (successCount > 0) {
      summaryText += `✅ Se publicaron **${successCount}** comentario(s) inline en el código.\n\n`;
    }
    
    if (failedComments.length > 0) {
      summaryText += `📝 **Comentarios adicionales:**\n\n`;
      failedComments.forEach(comment => {
        summaryText += `- **${comment.file}:${comment.line}** - ${comment.comment}\n`;
      });
      summaryText += "\n";
    }
    
    if (successCount === 0 && failedComments.length === 0) {
      summaryText += "No se encontraron comentarios relevantes.";
    }

    await postGeneralComment(projectId, mrIid, summaryText);

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error al procesar el webhook:", err.message || err);
    return res.status(500).send("Error interno");
  }
});

// 🔧 Función mejorada: Crear mapa de líneas modificadas con line_codes
function createFileLineMap(changes) {
  const fileLineMap = {};
  
  changes.forEach(change => {
    const filePath = change.new_path || change.old_path;
    fileLineMap[filePath] = {
      lines: new Set(),
      lineCodes: new Map(), // Mapea número de línea -> line_code
      oldLines: new Map(),  // Mapea número de línea nueva -> línea vieja
      addedLines: new Set() // Solo líneas añadidas
    };
    
    if (change.diff) {
      const lines = change.diff.split('\n');
      let newLineNumber = 0;
      let oldLineNumber = 0;
      let inHunk = false;
      
      lines.forEach((line, index) => {
        if (line.startsWith('@@')) {
          // Extraer números de línea del header
          const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match) {
            oldLineNumber = parseInt(match[1]) - 1; // -1 porque se incrementa antes de usar
            newLineNumber = parseInt(match[2]) - 1; // -1 porque se incrementa antes de usar
            inHunk = true;
          }
        } else if (inHunk && line.startsWith('+') && !line.startsWith('+++')) {
          // Línea añadida
          newLineNumber++;
          const lineCode = generateLineCode(filePath, change, oldLineNumber, newLineNumber);
          fileLineMap[filePath].lines.add(newLineNumber);
          fileLineMap[filePath].lineCodes.set(newLineNumber, lineCode);
          fileLineMap[filePath].addedLines.add(newLineNumber);
          
          console.log(`➕ Línea añadida en ${filePath}:${newLineNumber} -> lineCode: ${lineCode}`);
        } else if (inHunk && line.startsWith('-') && !line.startsWith('---')) {
          // Línea eliminada
          oldLineNumber++;
        } else if (inHunk && !line.startsWith('\\') && line !== '') {
          // Línea sin cambios (contexto)
          newLineNumber++;
          oldLineNumber++;
          const lineCode = generateLineCode(filePath, change, oldLineNumber, newLineNumber);
          fileLineMap[filePath].lines.add(newLineNumber);
          fileLineMap[filePath].lineCodes.set(newLineNumber, lineCode);
          fileLineMap[filePath].oldLines.set(newLineNumber, oldLineNumber);
        }
      });
    }
  });
  
  return fileLineMap;
}

// 🔧 Generar line_code más robusto para GitLab
function generateLineCode(filePath, change, oldLine, newLine) {
  // Usar el formato que GitLab espera
  const crypto = require('crypto');
  
  // Crear un identificador único basado en el contenido del cambio
  const changeId = `${change.old_path || ''}_${change.new_path || ''}_${oldLine}_${newLine}`;
  const hash = crypto.createHash('sha1').update(changeId).digest('hex');
  
  // Formato de line_code de GitLab: hash_oldLine_newLine
  return `${hash.substring(0, 8)}_${oldLine}_${newLine}`;
}

// 🔧 Nueva función: Validar que la línea existe en el diff
function validateLineInDiff(suggestion, fileLineMap) {
  const filePath = suggestion.file;
  const lineNumber = suggestion.line;
  
  if (!fileLineMap[filePath]) {
    console.warn(`⚠️ Archivo ${filePath} no encontrado en el diff`);
    return false;
  }
  
  const hasLine = fileLineMap[filePath].lines.has(lineNumber);
  console.log(`🔍 Validando ${filePath}:${lineNumber} -> ${hasLine ? 'VÁLIDA' : 'NO VÁLIDA'}`);
  console.log(`📋 Líneas disponibles para ${filePath}:`, Array.from(fileLineMap[filePath].lines).sort((a, b) => a - b));
  
  return hasLine;
}

// 🔧 Obtener line_code para una línea específica
function getLineCode(suggestion, fileLineMap) {
  const filePath = suggestion.file;
  const lineNumber = suggestion.line;
  
  if (!fileLineMap[filePath]) {
    console.warn(`⚠️ Archivo ${filePath} no encontrado en fileLineMap`);
    return null;
  }
  
  const lineCode = fileLineMap[filePath].lineCodes.get(lineNumber);
  console.log(`🔑 LineCode para ${filePath}:${lineNumber} -> ${lineCode}`);
  
  return lineCode;
}

async function postGeneralComment(projectId, mrIid, text) {
  const resp = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': GITLAB_TOKEN
    },
    body: JSON.stringify({ body: text })
  });
  
  if (!resp.ok) {
    const errorData = await resp.json();
    throw new Error(`Error posting general comment: ${JSON.stringify(errorData)}`);
  }
  
  console.log("💬 Comentario general publicado");
}

async function postInlineComment(projectId, mrIid, suggestion, baseSha, headSha, startSha, lineCode) {
  const body = {
    body: suggestion.comment,
    position: {
      position_type: "text",
      base_sha: baseSha,
      head_sha: headSha,
      start_sha: startSha,
      new_path: suggestion.file,
      new_line: suggestion.line,
      line_code: lineCode
    }
  };

  console.log(`🔍 Intentando comentario inline:`, {
    file: suggestion.file,
    line: suggestion.line,
    lineCode: lineCode,
    shas: { baseSha, headSha, startSha }
  });

  const resp = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': GITLAB_TOKEN
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errorData = await resp.json();
    console.error(`❌ Detalles del error de GitLab:`, errorData);
    throw new Error(`GitLab API Error: ${resp.status} - ${JSON.stringify(errorData)}`);
  }

  const responseData = await resp.json();
  console.log(`💬 Comentario inline exitoso en ${suggestion.file}:${suggestion.line}`, responseData.id);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});