require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function reviewDiffInline(diffText) {
  const prompt = `
Sos un asistente de revisión de código que analiza un diff de Git y devuelve sugerencias en formato JSON para líneas NUEVAS o MODIFICADAS (líneas que comienzan con '+').

Indicaciones:
- Solo analiza archivos de código (JavaScript, TypeScript, Python, Java, Rust).
- Ignorá HTML, JSON, Markdown u otros archivos no relevantes.
- Las sugerencias deben referirse a líneas añadidas/modificadas.
- Para cada sugerencia, indicá:
  - file: ruta relativa del archivo
  - line: número de línea NUEVA (según el archivo modificado)
  - comment: sugerencia de mejora, bug potencial o estilo
- Respondé SOLO con un JSON válido (sin markdown ni texto extra).
- Si no hay sugerencias, devolvé un array vacío: []

Ejemplo esperado:
[
  { "file": "src/utils.js", "line": 42, "comment": "Consider renaming this variable to be more descriptive." }
]
`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: prompt.trim() },
        { role: 'user', content: `Revisá el siguiente diff y devolvé sugerencias para líneas nuevas o modificadas:\n\n${diffText}` }
      ],
      temperature: 0.2,
      max_tokens: 800
    })
  });

  const data = await response.json();

  if (!data.choices || !data.choices[0]?.message?.content) {
    console.error("❌ Error en la respuesta de OpenAI:", JSON.stringify(data, null, 2));
    throw new Error("La respuesta del LLM no fue válida.");
  }

  const rawContent = data.choices[0].message.content.trim();
  console.log("🧠 Respuesta cruda del modelo:\n", rawContent.slice(0, 500)); // para debug

  const cleaned = rawContent
    .replace(/^```json\s*/, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();

  try {
    const suggestions = JSON.parse(cleaned);
    const validSuggestions = suggestions.filter(s =>
      s.file && typeof s.file === 'string' &&
      s.line && typeof s.line === 'number' &&
      s.comment && typeof s.comment === 'string'
    );

    console.log(`✅ ${validSuggestions.length} sugerencias válidas de ${suggestions.length || 0} total`);
    return validSuggestions;
  } catch (e) {
    console.error("❌ Error al parsear JSON devuelto:", cleaned);
    return [];
  }
}

module.exports = { reviewDiffInline };
