async function run() {
  const body = {
    model: "google/gemini-2.5-flash",
    messages: [{role: "user", content: "hello"}],
    this_is_an_invalid_property_for_sure: 123
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
