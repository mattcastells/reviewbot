// webhookServer.js
require('dotenv').config();
const express = require('express');
const { reviewDiffInline } = require('./reviewBot');
const fetch = require('node-fetch');

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

  try {
    const changesUrl = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/changes`;

    const changesResp = await fetch(changesUrl, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
    });

    const changesData = await changesResp.json();
    const diffs = changesData.changes || [];

    // Unimos los diffs en un formato entendible
    const fullDiff = diffs.map(file => {
      return `diff --git a/${file.old_path} b/${file.new_path}\n${file.diff}`;
    }).join("\n");

    console.log("📄 Enviando diff al LLM...");
    const suggestions = await reviewDiffInline(fullDiff);

    if (suggestions.length === 0) {
      // Fallback: comentario general
      await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': GITLAB_TOKEN
        },
        body: JSON.stringify({
          body: `🤖 **Revisión automática del LLM:**\n\nNo se encontraron observaciones relevantes.`
        })
      });
      console.log("💬 Comentario general publicado (sin sugerencias)");
      return res.status(200).send("OK");
    }

    // Comentarios inline
    for (const s of suggestions) {
      await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': GITLAB_TOKEN
        },
        body: JSON.stringify({
          body: s.comment,
          position: {
            position_type: 'text',
            base_sha: event.object_attributes.diff_refs.base_sha,
            start_sha: event.object_attributes.diff_refs.start_sha,
            head_sha: event.object_attributes.diff_refs.head_sha,
            new_path: s.file,
            new_line: s.line
          }
        })
      });
      console.log(`✅ Comentario inline publicado en ${s.file}:${s.line}`);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error al procesar el webhook:", err.message || err);
    res.status(500).send(err.message || "Error interno");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
