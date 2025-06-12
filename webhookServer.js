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
    return res.status(200).send("Event not supported");
  }

  const mr = event.object_attributes;
  const projectId = event.project.id;
  const mrIid = mr.iid;

  console.log(`📦 Merge Request received: !${mrIid} in ${event.project.name}`);

  try {
    // ✅ Use the GitLab API to get the real changes
    const diffApiUrl = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/changes`;

    const diffResp = await fetch(diffApiUrl, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
    });

    const diffJson = await diffResp.json();

    // Log the full response for debugging
    console.log("🔎 GitLab API response:", JSON.stringify(diffJson, null, 2));

    if (!diffJson.changes || !Array.isArray(diffJson.changes)) {
      console.error("❌ GitLab API error or unexpected response:", JSON.stringify(diffJson, null, 2));
      return res.status(500).send("GitLab API error or unexpected response");
    }

    const diff = diffJson.changes
      .map(change => `diff --git a/${change.old_path} b/${change.new_path}\n${change.diff}`)
      .join('\n\n');

    console.log("📄 Real DIFF received:\n", diff);

    const review = await reviewDiff(diff);

    await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': GITLAB_TOKEN
      },
      body: JSON.stringify({
        body: `🤖 **Automatic LLM Review:**\n\n${review}`
      })
    });

    console.log("✅ Comment posted successfully");
    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error processing webhook:", err.message || err);
    res.status(500).send(err.message || "Internal error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening at http://localhost:${PORT}`);
});
