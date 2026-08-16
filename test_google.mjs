async function run() {
  const disableSafety = [
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }
  ];
  const body = {
    model: "gemini-2.5-flash",
    messages: [{role: "user", content: "hello"}],
    safetySettings: disableSafety,
    safety_settings: disableSafety
  };

  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer AIzaSyA-fakekey"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  console.log("Status:", res.status, text);
}
run();
