import os
import requests
from flask import Flask, request, jsonify, render_template, send_from_directory

app = Flask(__name__, template_folder="templates", static_folder="static")

# OpenRouter API Key
API_KEY = os.environ.get("OPENROUTER_API_KEY")

def call_openrouter(system_prompt, user_prompt):
    if not API_KEY:
        raise Exception("OPENROUTER_API_KEY is not set.")
        
    response = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "google/gemini-2.0-flash-001", 
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        }
    )
    
    if response.status_code != 200:
        raise Exception(f"OpenRouter API Error: {response.text}")
        
    return response.json()["choices"][0]["message"]["content"]

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/debate", methods=["POST"])
def debate():
    data = request.get_json()
    topic = data.get("topic")
    if not topic:
        return jsonify({"error": "Topic is required"}), 400

    try:
        # Step 1: Analyst
        analyst_sys = "You are the Analyst 🌞. Break down the user's topic logically. Provide clear, objective facts and define the core problem or concept."
        analyst_response = call_openrouter(analyst_sys, topic)
        
        # Step 2: Creative responds to Analyst
        creative_sys = "You are the Creative 🌸. Read the Analyst's breakdown and generate novel, out-of-the-box ideas, alternatives, or innovative approaches."
        creative_prompt = f"Topic: {topic}\n\nAnalyst's Breakdown:\n{analyst_response}"
        creative_response = call_openrouter(creative_sys, creative_prompt)
        
        # Step 3: Critic critiques both
        critic_sys = "You are the Critic 🌧️. Review the Analyst's logic and the Creative's ideas. Point out flaws, risks, unproven assumptions, and potential downsides."
        critic_prompt = f"Topic: {topic}\n\nAnalyst:\n{analyst_response}\n\nCreative:\n{creative_response}"
        critic_response = call_openrouter(critic_sys, critic_prompt)
        
        # Step 4: Moderator synthesizes using book principles
        moderator_sys = (
            "You are the Moderator ⚖️. Synthesize the perspectives of the Analyst, Creative, and Critic. "
            "Use the book's core principles to find a balanced, actionable conclusion. "
            "Reference the book summary explicitly to frame your final verdict."
        )
        moderator_prompt = f"Topic: {topic}\n\nAnalyst:\n{analyst_response}\n\nCreative:\n{creative_response}\n\nCritic:\n{critic_response}"
        moderator_response = call_openrouter(moderator_sys, moderator_prompt)
        
        return jsonify({
            "analyst": analyst_response,
            "creative": creative_response,
            "critic": critic_response,
            "moderator": moderator_response
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
