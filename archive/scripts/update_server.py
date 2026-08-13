import re

with open('server.ts', 'r') as f:
    content = f.read()

# Replace /api/openrouter -> /api/council
content = content.replace('app.post("/api/openrouter"', 'app.post("/api/council"')
content = content.replace('app.get("/api/openrouter/account"', 'app.get("/api/council/account"')

# Add GET /api/health before app.post
health_endpoint = """  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

"""
if "app.get(\"/api/health\"" not in content:
    content = content.replace('app.post("/api/council"', health_endpoint + 'app.post("/api/council"')

# Add GET /api/council/models proxy
models_endpoint = """  app.get("/api/council/models", async (req, res) => {
    try {
      const sort = req.query.sort || 'newest';
      const response = await fetch(`https://openrouter.ai/api/v1/models?sort=${sort}`);
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

"""
if "app.get(\"/api/council/models\"" not in content:
    content = content.replace('app.get("/api/council/account"', models_endpoint + 'app.get("/api/council/account"')

with open('server.ts', 'w') as f:
    f.write(content)
