require('dotenv').config();
const express = require('express');
const { reviewDiff } = require('./reviewBot');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

// Endpoint del webhook de GitLab
app.post('/webhook', async (req, res) => {
  const event = req.body;

  // Validamos que sea un MR
  if (event.object_kind !== 'merge_request') {
    return res.status(200).send("Evento no soportado");
  }

  const mr = event.object_attributes;
  const projectId = event.project.id;
  const mrIid = mr.iid;

  console.log(`📦 Merge Request recibido: !${mrIid} en ${event.project.name}`);

  try {
    // Obtener diff completo del MR
    const diffUrl = `${event.project.web_url}/-/merge_requests/${mrIid}.diff`;

    const diffResp = await fetch(diffUrl, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
    });

    const diff = await diffResp.text();

    const review = await reviewDiff(diff);

    // Comentar en el MR usando la API de GitLab
    const commentResp = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`, {
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
    console.error("❌ Error al procesar el webhook:", err);
    res.status(500).send("Error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
