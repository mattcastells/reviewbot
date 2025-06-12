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
        await postInlineComment(projectId, mrIid, suggestion, base_sha, head_sha, start_sha);
        successCount++;
      } catch (err) {
        console.error(`❌ Error publicando comentario inline en ${suggestion.file}:${suggestion.line}:`, err.message || err);
        failedComments.push(suggestion);
      }
    }

    let summaryText = "🤖 **Revisión automática del LLM**\n\n";

    if (successCount > 0) {
      summaryText += `✅ Se publicaron **${successCount}** comentario(s) inline.\n\n`;
    }

    if (failedComments.length > 0) {
      summaryText += `📝 **Comentarios generales:**\n`;
      for (const c of failedComments) {
        summaryText += `- **${c.file}:${c.line}** – ${c.comment}\n`;
      }
    }

    if (successCount === 0 && failedComments.length === 0) {
      summaryText += "No se encontraron sugerencias relevantes.";
    }

    await postGeneralComment(projectId, mrIid, summaryText);

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error al procesar el webhook:", err.message || err);
    return res.status(500).send("Error interno");
  }
});

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

  console.log(`🔍 Publicando inline en ${suggestion.file}:${suggestion.line}`);
  console.log("🧾 Payload:", JSON.stringify(body, null, 2));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
