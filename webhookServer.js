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
    for (const suggestion of suggestions) {
      try {
        // 🔧 Validar que la línea existe en el diff
        if (!validateLineInDiff(suggestion, fileLineMap)) {
          console.warn(`⚠️ Línea ${suggestion.line} no encontrada en ${suggestion.file}, saltando...`);
          continue;
        }
        
        await postInlineComment(projectId, mrIid, suggestion, base_sha, head_sha, start_sha);
        successCount++;
      } catch (err) {
        console.error(`❌ Error publicando comentario inline en ${suggestion.file}:${suggestion.line}:`, err.message || err);
        
        // 🔧 Intentar como comentario general si falla el inline
        try {
          const fallbackText = `**${suggestion.file}:${suggestion.line}** - ${suggestion.comment}`;
          await postGeneralComment(projectId, mrIid, fallbackText);
          console.log(`✅ Publicado como comentario general: ${suggestion.file}:${suggestion.line}`);
        } catch (fallbackErr) {
          console.error(`❌ Error en fallback:`, fallbackErr.message);
        }
      }
    }

    const summary = successCount > 0
      ? `🤖 Revisión automática del LLM:\n\nSe publicaron ${successCount} comentario(s) inline en el código.`
      : "🤖 Revisión automática del LLM:\n\nNo se encontraron comentarios relevantes.";

    await postGeneralComment(projectId, mrIid, summary);

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error al procesar el webhook:", err.message || err);
    return res.status(500).send("Error interno");
  }
});

// 🔧 Nueva función: Crear mapa de líneas modificadas por archivo
function createFileLineMap(changes) {
  const fileLineMap = {};
  
  changes.forEach(change => {
    const filePath = change.new_path || change.old_path;
    fileLineMap[filePath] = new Set();
    
    if (change.diff) {
      const lines = change.diff.split('\n');
      let newLineNumber = 0;
      let oldLineNumber = 0;
      
      lines.forEach(line => {
        if (line.startsWith('@@')) {
          // Extraer números de línea del header
          const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match) {
            oldLineNumber = parseInt(match[1]);
            newLineNumber = parseInt(match[2]);
          }
        } else if (line.startsWith('+')) {
          // Línea añadida
          fileLineMap[filePath].add(newLineNumber);
          newLineNumber++;
        } else if (line.startsWith('-')) {
          // Línea eliminada
          oldLineNumber++;
        } else if (!line.startsWith('\\')) {
          // Línea sin cambios
          fileLineMap[filePath].add(newLineNumber);
          newLineNumber++;
          oldLineNumber++;
        }
      });
    }
  });
  
  return fileLineMap;
}

// 🔧 Nueva función: Validar que la línea existe en el diff
function validateLineInDiff(suggestion, fileLineMap) {
  const filePath = suggestion.file;
  const lineNumber = suggestion.line;
  
  if (!fileLineMap[filePath]) {
    console.warn(`⚠️ Archivo ${filePath} no encontrado en el diff`);
    return false;
  }
  
  return fileLineMap[filePath].has(lineNumber);
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

async function postInlineComment(projectId, mrIid, suggestion, baseSha, headSha, startSha) {
  const body = {
    body: suggestion.comment,
    position: {
      position_type: "text",
      base_sha: baseSha,
      head_sha: headSha,
      start_sha: startSha,
      new_path: suggestion.file,
      new_line: suggestion.line
    }
  };

  console.log(`🔍 Intentando comentario inline:`, {
    file: suggestion.file,
    line: suggestion.line,
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