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
    const diffData = await diffResp.json();

    const combinedDiff = diffData.changes.map(change => {
      return `diff --git a/${change.old_path} b/${change.new_path}\n${change.diff}`;
    }).join('\n');

    const suggestions = await reviewDiffInline(combinedDiff);

    if (!suggestions || suggestions.length === 0) {
      await postGeneralComment(projectId, mrIid, "🤖 Revisión automática del LLM:\n\nNo se encontraron comentarios relevantes.");
      return res.status(200).send("Sin sugerencias");
    }

    const { base_sha, head_sha, start_sha } = diffData.diff_refs;

    await Promise.all(suggestions.map(s =>
      postInlineComment(projectId, mrIid, s, base_sha, head_sha, start_sha)
    ));

    await postGeneralComment(projectId, mrIid, "🤖 Revisión automática del LLM:\n\nSe publicaron comentarios inline en el código.");

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error al procesar el webhook:", err.message || err);
    return res.status(500).send("Error interno");
  }
});

async function postGeneralComment(projectId, mrIid, text) {
  await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': GITLAB_TOKEN
    },
    body: JSON.stringify({ body: text })
  });
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

  await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': GITLAB_TOKEN
    },
    body: JSON.stringify(body)
  });

  console.log(`💬 Comentario inline en ${suggestion.file}:${suggestion.line}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});