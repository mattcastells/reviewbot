require('dotenv').config();
const express = require('express');
const { reviewDiff } = require('./reviewBot');
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
    // ✅ Usar la API de GitLab para obtener los cambios reales
    const diffApiUrl = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/changes`;

    const diffResp = await fetch(diffApiUrl, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
    });

    const diffJson = await diffResp.json();

    const diff = diffJson.changes
      .map(change => `diff --git a/${change.old_path} b/${change.new_path}\n${change.diff}`)
      .join('\n\n');

    console.log("📄 DIFF real recibido:\n", diff);

    const review = await reviewDiff(diff);

    await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': GITLAB_TOKEN
      },
      body: JSON.stringify({
        body: `🤖 **Revisión automática del LLM:**\n\n${review}`
      })
    });

    console.log("✅ Comentario publicado correctamente");
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
