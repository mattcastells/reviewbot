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
          content: `You are a technical assistant specialized in code and documentation reviews. Your task is to analyze the changes (diffs) of Merge Requests in GitLab.

          Review and comment on:
          - Source code in languages like JavaScript, TypeScript, Python, Java, Rust
          - Changes in configuration files (.env, .json, etc.)
          - Documentation content: README.md, .md or .txt files

          Detect:
          - Logical errors
          - Poor naming
          - Issues with writing, clarity, grammar, spelling
          - Ambiguity or lack of precision in documentation

          Ignore irrelevant content such as:
          - Obfuscated or minified HTML
          - Auto-generated files
          - Content without real text or logic (unchanged CSS, images, etc.)

          If there is nothing relevant, respond exactly:
          "No significant content found for review."`
        },
        {
          role: 'user',
          content: `Review this diff:\n\n${diffText}`
        }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();

  if (!data.choices) {
    console.error("❌ OpenAI API error:", JSON.stringify(data, null, 2));
    throw new Error("LLM response failed");
  }

  return data.choices[0].message.content;
}

module.exports = { reviewDiff };
