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
          content: `Sos un asistente técnico que revisa únicamente código fuente de desarrollo (JavaScript, TypeScript, Python, Java, Rust). 

Ignorá cualquier diff que incluya:
- HTML minificado
- Código autogenerado
- Archivos de seguridad o protección (como Cloudflare)
- Archivos sin contenido de lógica (README, configs, CSS, etc.)

Si el diff no contiene código fuente claro de backend o frontend lógico, respondé exactamente:
"No se encontró código relevante para revisión."

No inventes contexto ni asumas propósito del código. No comentes si el contenido no es explícitamente revisable.`
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
