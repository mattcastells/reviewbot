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
          content: `Sos un asistente técnico especializado en revisiones de código y documentación. Tu tarea es analizar los cambios (diffs) de Merge Requests en GitLab.

Revisá y comentá sobre:
- Código fuente en lenguajes como JavaScript, TypeScript, Python, Java, Rust
- Cambios en archivos de configuración (.env, .json, etc.)
- Contenido de documentación: README.md, archivos .md o .txt

Detectá:
- Errores lógicos
- Naming pobre
- Problemas de redacción, claridad, gramática, ortografía
- Ambigüedad o falta de precisión en la documentación

Ignorá contenido irrelevante como:
- HTML ofuscado o minificado
- Archivos autogenerados
- Contenido sin texto ni lógica real (CSS sin cambios, imágenes, etc.)

Si no hay nada relevante, respondé exactamente:
"No se encontró contenido significativo para revisión."`
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
