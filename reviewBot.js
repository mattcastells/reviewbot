require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function reviewDiff(diffText) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Sos un experto en revisión de código. Tu tarea es analizar los cambios (diffs) de Merge Requests en GitLab. Respondé únicamente si el diff contiene código fuente (no HTML autogenerado, ni contenido minificado o de seguridad).

Concentrate en:
- Código en lenguajes como JavaScript, TypeScript, Python, Java, Rust
- Errores lógicos, problemas de diseño, naming, performance, legibilidad

Ignorá contenido irrelevante, HTML ofuscado o contenido no programático.

Respondé con un comentario técnico, claro y concreto. Si el diff no contiene código útil, indicá que no hay nada para revisar.`
        },
        {
          role: 'user',
          content: `Revisá este diff:\n\n${diffText}`
        }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();

  if (!data.choices) {
    console.error("❌ Error de OpenAI API:", JSON.stringify(data, null, 2));
    throw new Error("Falló la respuesta del LLM");
  }

  return data.choices[0].message.content;
}

module.exports = { reviewDiff };
