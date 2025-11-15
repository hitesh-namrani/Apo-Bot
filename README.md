Apo-Bot: AI Healthcare Assistant

Team: Coding Mafia
Track: Healthcare & Wellbeing
Status: Hackathon Prototype (Work-in-Progress)

:warning: SECURITY WARNING

This project uses the Google Gemini API, which requires a secret API key. Do NOT commit your API key directly to index.js or any other file.

Note: Any API keys found in the public commit history are mock keys, do not work, and have been revoked.

To run this project, you must generate your own key and store it in a .env file (as described below) to keep it safe and private.

About This Project

Apo-Bot was a prototype submitted for the Coding Mafia Hackfest. Our goal was to create an intelligent, conversational AI assistant to help users manage their healthcare needs, from booking appointments to tracking their health.

This repository contains the project in its current state at the end of the hackathon. Due to the time constraints of the event, development was paused. Our team plans to continue working on this project to add more features and refine the existing ones.

Current Features

Conversational AI Chat: Powered by the Google Gemini API, the bot can understand conversational history and context.

Database-Grounded AI: The bot's responses are grounded in real-time data from a MongoDB database, allowing it to check actual doctor availability and patient history.

Smart Appointment Booking: The bot can understand natural language requests (e.g., "I have a cough," "I need an appointment around 6 pm"), find a matching doctor and slot, and save the confirmed appointment to the database.

Health Tracking: A UI to log and visualize health metrics.

Medical History: A UI to view and manage patient records.

Tech Stack

Frontend: Vanilla HTML, CSS, and JavaScript

Backend: Node.js & Express.js

Database: MongoDB (using Mongoose)

AI: Google Gemini API (for conversational intelligence and action-generation)

Security: dotenv for managing environment variables.

How to Run This Project

Prerequisites:

Node.js

MongoDB (must be running locally)

A Google Gemini API Key (Get one from Google AI Studio)

ngrok (for tunneling)

1. Clone the Repository

git clone [your-github-repo-url]
cd [your-project-folder]


2. Install Dependencies
This will download all the packages listed in package.json (like Express, Mongoose, and the new dotenv package).

npm install


3. Set Up Your API Key (The Secure Way)

In your project folder, create a new file named .env

Add one line to this new file, pasting in your own API key:

GEMINI_API_KEY=PASTE_YOUR_NEW_API_KEY_HERE


The .gitignore file will prevent this file from ever being uploaded to GitHub.

4. Run the Server
You will need three terminals running at the same time.

Terminal 1: Start MongoDB
(Run the command to start your MongoDB service, e.g., mongod)

mongod


Terminal 2: Start the Node.js Server

node index.js


You should see:
Backend server is running on http://localhost:8080
Connected to LOCAL MongoDB!

Terminal 3: Start ngrok
This will create a public URL that points to your local server.

ngrok http 8080


Copy the https: ... .dev URL from the Forwarding line.

5. Update the Frontend

Open the chat_page.html file.

Find the BACKEND_URL constant (around line 133).

Paste your ngrok URL between the quotes.

6. View the App

Open the apobot_landing (1).html file in your web browser.

Click "Start Chatting Now" to begin.

Future Plans

As noted, this is a prototype. Our team plans to continue development, focusing on:

Re-integrating Agora RTC: Our original plan included live, one-on-one video tele-consultations with doctors. We will add this feature back using Agora's Video SDK.

Refining AI: Improve the prompt engineering to handle more complex user requests.

Full CRUD: Add "Edit" and "Delete" functionality to the Medical History and Health Tracker pages.

User Authentication: Implement a proper login system for patients and doctors.
