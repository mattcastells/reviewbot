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
          content: `Sos un asistente de revisión de código que devuelve sugerencias en formato JSON para comentarios inline. 

IMPORTANTE: Solo devolvé comentarios para líneas que fueron MODIFICADAS o AÑADIDAS en el diff (líneas que empiezan con + en el diff).

Analizá solo diffs en lenguajes como JavaScript, TypeScript, Python, Java o Rust. Ignorá HTML, contenido ofuscado o autogenerado. 

Para cada sugerencia, asegurate de que:
1. El archivo existe en el diff
2. La línea corresponde a una línea nueva/modificada (+ en el diff)
3. El número de línea es correcto según el diff

Formato esperado:
[
  { "file": "src/file.ts", "line": 10, "comment": "Este nombre podría ser más descriptivo." },
  ...
]

Si no hay comentarios relevantes, devolvé un array vacío: []`
        },
        {
          role: 'user',
          content: `Revisá este diff y devolvé SOLO comentarios para líneas que fueron añadidas o modificadas:\n\n${diffText}`
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

  const rawContent = data.choices[0].message.content.trim();

  // 🔧 Mejor limpieza del JSON
  const cleaned = rawContent
    .replace(/^```json\s*/, '')   
    .replace(/^```\s*/, '')       
    .replace(/```$/, '')          
    .trim();

  try {
    const suggestions = JSON.parse(cleaned);
    
    // 🔧 Validar estructura de cada sugerencia
    const validSuggestions = suggestions.filter(suggestion => {
      if (!suggestion.file || !suggestion.line || !suggestion.comment) {
        console.warn(`⚠️ Sugerencia inválida ignorada:`, suggestion);
        return false;
      }
      return true;
    });
    
    console.log(`✅ ${validSuggestions.length} sugerencias válidas de ${suggestions.length} total`);
    return validSuggestions;
    
  } catch (e) {
    console.error("❌ No se pudo parsear el JSON devuelto:", rawContent);
    return [];
  }
}

module.exports = { reviewDiffInline };