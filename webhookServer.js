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
    const diffUrl = `${event.project.web_url}/-/merge_requests/${mrIid}.diff`;

    const diffResp = await fetch(diffUrl, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
    });

    const diff = await diffResp.text();
    console.log("📄 Enviando diff al LLM...");

    const inlineComments = await reviewDiffInline(diff);

    // Comentario general
    let generalMessage = "🤖 **Revisión automática del LLM:**\n\n";
    if (inlineComments.length === 0) {
      generalMessage += "No se encontraron sugerencias significativas para comentar.";
    } else {
      generalMessage += "Se encontraron sugerencias inline. Revisá los comentarios en el código.";
    }

    await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': GITLAB_TOKEN
      },
      body: JSON.stringify({ body: generalMessage })
    });

    console.log("💬 Comentario general publicado");

    // Publicar comentarios inline
    if (inlineComments.length > 0) {
      const changesResp = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/changes`, {
        headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
      });
      const changes = await changesResp.json();

      const baseSha = changes.diff_refs?.base_sha;
      const headSha = changes.diff_refs?.head_sha;

      if (!baseSha || !headSha) {
        throw new Error("diff_refs.base_sha o head_sha no están definidos");
      }

      for (const comment of inlineComments) {
        try {
          await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'PRIVATE-TOKEN': GITLAB_TOKEN
            },
            body: JSON.stringify({
              body: comment.comment,
              position: {
                position_type: "text",
                base_sha: baseSha,
                head_sha: headSha,
                start_sha: baseSha,
                new_path: comment.file,
                new_line: comment.line
              }
            })
          });
        } catch (err) {
          console.error(`⚠️ Falló comentario inline en ${comment.file}:${comment.line}:`, err.message);
        }
      }

      console.log("✅ Comentarios inline publicados");
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
