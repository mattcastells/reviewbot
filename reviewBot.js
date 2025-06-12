// reviewBot.js
require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function reviewDiffInline(diffText) {
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
          content: `Sos un asistente de revisión de código que devuelve sugerencias en formato JSON para comentarios inline. Solo analizá diffs en lenguajes como JavaScript, TypeScript, Python, Java o Rust. Ignorá HTML, contenido ofuscado o autogenerado. Formato esperado:

[
  { "file": "src/file.ts", "line": 10, "comment": "Este nombre podría ser más descriptivo." },
  ...
]`
        },
        {
          role: 'user',
          content: `Revisá este diff:

${diffText}`
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

  try {
    return JSON.parse(data.choices[0].message.content);
  } catch (e) {
    console.error("❌ Respuesta del LLM no es JSON:", data.choices[0].message.content);
    return [];
  }
}

module.exports = { reviewDiffInline };
