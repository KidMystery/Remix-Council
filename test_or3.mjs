async function run() {
  const disableSafety = [
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }
  ];
  const body = {
    model: "google/gemini-2.5-flash",
    messages: [{role: "user", content: "hello"}],
    safety_settings: disableSafety,
    plugins: { google_safety_settings: disableSafety }
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-or-v1-fakekey"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  console.log("Status:", res.status, text);
}
run();
