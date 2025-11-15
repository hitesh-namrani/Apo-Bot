const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const cors = require('cors');

// --- 1. CONFIGURATION ---
const PORT = process.env.PORT || 8080;
const DB_URL = process.env.DB_URL || 'mongodb://localhost:27017/apoBotDB';

// --- GEMINI API CONFIG ---
// 1. Get your key from https://aistudio.google.com/app/apikey
// 2. Paste it between the quotes.
const API_KEY = "AIzaSyC6nn-Xtyf6wmHAanHcivE1ll1JYan0_oo";
// -------------------------

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- 2. DATABASE CONNECTION & SCHEMAS ---
mongoose.connect(DB_URL)
    .then(() => console.log('Connected to LOCAL MongoDB!'))
    .catch(err => {
        console.error('Failed to connect to MongoDB', err);
        process.exit(1);
    });

// --- Schemas (Unchanged) ---
const SymptomMapSchema = new mongoose.Schema({
    symptom: { type: String, unique: true, lowercase: true },
    specialist: String
});
const SymptomMap = mongoose.model('SymptomMap', SymptomMapSchema);

const DoctorSchema = new mongoose.Schema({
    name: String,
    specialization: String,
    availability: [String], // Storing as ISO Date strings
    status: String, // 'online' or 'offline'
    experience: String, // e.g., "15 years"
    rating: Number, // e.g., 4.8
    photo: String // e.g., "👨‍⚕️"
});
const Doctor = mongoose.model('Doctor', DoctorSchema);

const PatientSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: String,
    dob: String,
    allergies: [String],
    conditions: [String],
    medications: [String]
});
const Patient = mongoose.model('Patient', PatientSchema);

const HealthTrackerSchema = new mongoose.Schema({
    userId: String,
    date: Date,
    type: String, // 'bp', 'glucose', 'heart', 'weight', 'temp'
    value: mongoose.Schema.Types.Mixed // Flexible for "120/80" or 75
});
const HealthTracker = mongoose.model('HealthTracker', HealthTrackerSchema);

const AppointmentSchema = new mongoose.Schema({
    userId: String,
    doctorName: String,
    specialty: String,
    date: String, // Readable date
    time: String, // Readable time
    slotISO: String, // The ISO string for the booked slot
    bookedAt: { type: Date, default: Date.now }
});
const Appointment = mongoose.model('Appointment', AppointmentSchema);

// --- 3. HELPER: POPULATE DB ONCE (FOR HACKATHON) ---
async function populateInitialData() {
    try {
        await Promise.all([
            Doctor.deleteMany({}),
            SymptomMap.deleteMany({}),
            Patient.deleteMany({}),
            HealthTracker.deleteMany({}),
            Appointment.deleteMany({})
        ]);

        await Doctor.insertMany([
            { name: "Dr. Priya Gupta", specialization: "General Physician", availability: ["2025-11-15T10:00:00Z", "2025-11-15T10:30:00Z", "2025-11-15T18:00:00Z", "2025-11-16T11:00:00Z"], status: "online", experience: "12 years", rating: 4.7, photo: "👩‍⚕️" },
            { name: "Dr. Rohan Rao", specialization: "Cardiologist", availability: ["2025-11-15T14:00:00Z", "2025-11-15T14:30:00Z"], status: "offline", experience: "18 years", rating: 4.9, photo: "👨‍⚕️" },
            { name: "Dr. Aisha Khan", specialization: "Dermatologist", availability: ["2025-11-16T09:00:00Z", "2025-11-16T09:30:00Z"], status: "online", experience: "10 years", rating: 4.9, photo: "👩‍⚕️" },
            { name: "Dr. Sanjay Rao", specialization: "Neurologist", availability: ["2025-11-17T11:00:00Z"], status: "online", experience: "20 years", rating: 4.9, photo: "👨‍⚕️" },
            { name: "Dr. Kavita Reddy", specialization: "Gastroenterologist", availability: ["2025-11-17T13:00:00Z", "2025-11-17T18:30:00Z"], status: "online", experience: "14 years", rating: 4.8, photo: "👩‍⚕️" }
        ]);

        await SymptomMap.insertMany([
            { symptom: "cough", specialist: "General Physician" }, { symptom: "fever", specialist: "General Physician" },
            { symptom: "rash", specialist: "Dermatologist" }, { symptom: "chest pain", specialist: "Cardiologist" },
            { symptom: "headache", specialist: "Neurologist" }, { symptom: "stomach pain", specialist: "Gastroenterologist" }
        ]);

        await Patient.insertMany([
            { userId: "user-nitin-123", name: "Nitin Sharma", dob: "1985-05-15", allergies: ["Peanuts"], conditions: ["Hypertension"], medications: ["Amlodipine 5mg"] }
        ]);

        await HealthTracker.insertMany([
            { userId: "user-nitin-123", date: new Date("2025-11-14T09:00:00Z"), type: "bp", value: { systolic: 125, diastolic: 82 } },
            { userId: "user-nitin-123", date: new Date("2025-11-15T09:05:00Z"), type: "bp", value: { systolic: 122, diastolic: 80 } }
        ]);

        console.log('Database populated with initial data.');
    } catch (err) {
        console.error('Error populating data:', err);
    }
}
populateInitialData();

// --- 5. NEW CONVERSATIONAL GEMINI AI LOGIC ---

// --- NEW: Refactored Database Logic for the AI to call ---

/**
 * Books an appointment in the database.
 * @param {string} doctorName - The name of the doctor.
 * @param {string} slotISO - The ISO 8601 string of the appointment slot.
 * @param {string} userId - The patient's user ID.
 * @returns {object} - An object with { success: true, appointment: ... } or { success: false, error: '...' }
 */
async function bookAppointmentInDb(doctorName, slotISO, userId) {
    console.log(`Attempting to book: ${doctorName} at ${slotISO} for ${userId}`);
    try {
        const updateResult = await Doctor.updateOne(
            { name: doctorName, availability: slotISO },
            { $pull: { availability: slotISO } }
        );

        if (updateResult.modifiedCount === 0) {
            console.warn("Booking failed: Slot was just taken or doesn't exist.");
            return { success: false, error: 'Slot just got booked. Please try another one.' };
        }

        const slotDate = new Date(slotISO);
        const newAppointment = new Appointment({
            userId,
            doctorName,
            specialty: (await Doctor.findOne({ name: doctorName }))?.specialization || '',
            date: slotDate.toLocaleDateString(),
            time: slotDate.toLocaleTimeString(),
            slotISO
        });
        await newAppointment.save();
        
        console.log("Booking successful:", newAppointment);
        return { success: true, appointment: newAppointment };

    } catch (err) {
        console.error("Error in bookAppointmentInDb:", err);
        return { success: false, error: err.message };
    }
}

/**
 * Logs a health metric to the database.
 * @param {string} metricType - e.g., 'bp', 'glucose'.
 * @param {string} metricValue - e.g., '120/80', '105'.
 * @param {string} userId - The patient's user ID.
 * @returns {object} - An object with { success: true } or { success: false, error: '...' }
 */
async function logMetricInDb(metricType, metricValue, userId) {
    console.log(`Attempting to log: ${metricType} as ${metricValue} for ${userId}`);
    try {
        let processedValue = metricValue;
        if (metricType === 'bp' && metricValue.includes('/')) {
            const [systolic, diastolic] = metricValue.split('/');
            processedValue = { systolic: Number(systolic), diastolic: Number(diastolic) };
        } else {
            processedValue = Number(metricValue);
        }

        await HealthTracker.create({ 
            userId, 
            date: new Date(), 
            type: metricType, 
            value: processedValue 
        });
        
        console.log("Log successful.");
        return { success: true };
    } catch (err) {
        console.error("Error in logMetricInDb:", err);
        return { success: false, error: err.message };
    }
}


// --- NEW: Updated Gemini Schema to include "action" ---
const geminiSchema = {
    type: "OBJECT",
    properties: {
        action: {
            type: "STRING",
            enum: ["BookAppointment", "LogMetric", "GetHistory", "None"],
            description: "The database action to perform. Use 'None' if only talking."
        },
        parameters: {
            type: "OBJECT",
            description: "Parameters for the action.",
            properties: {
                doctorName: { type: "STRING", description: "The full name of the doctor, e.g., 'Dr. Priya Gupta'" },
                slotISO: { type: "STRING", description: "The full ISO 8601 string for the slot, e.g., '2025-11-15T18:00:00Z'" },
                metricType: { type: "STRING", description: "The type of metric, e.g., 'bp' or 'glucose'" },
                metricValue: { type: "STRING", description: "The value of the metric, e.g., '120/80' or '105'" }
            }
        },
        reply: {
            type: "STRING",
            description: "The conversational text reply to send to the user."
        }
    },
    required: ["reply"]
};

/**
 * This is the NEW "brain" of our bot, powered by Gemini.
 * It now understands conversation history and is "grounded" with live database data.
 * It also returns an "action" for the backend to perform.
 */
async function getAIResponse(userId, chatHistory) {
    const activeUserId = userId || "user-nitin-123";

    if (API_KEY === "PASTE_YOUR_GEMINI_API_KEY_HERE" || API_KEY === "") {
        console.error("Gemini API Error: API_KEY is not set in index.js");
        return { reply: "I'm sorry, my AI brain isn't connected. The API key is missing. (This is a backend error)" };
    }

    try {
        // --- 1. Grounding: Fetch LIVE data from our database ---
        const [doctors, patient, symptomMap] = await Promise.all([
            Doctor.find(), // Get *all* doctors and their *current* availability
            Patient.findOne({ userId: activeUserId }),
            SymptomMap.find()
        ]);

        // --- 2. Create a new, smarter System Prompt ---
        // --- FIX: Escaped all internal backticks \` ---
        const systemPrompt = `You are Apo-Bot, a friendly and professional AI healthcare assistant.
Your job is to manage a patient's healthcare needs.
Today is ${new Date().toDateString()}. Video calls are disabled.

**YOUR TOOLS (LIVE DATABASE DATA):**

1.  **Patient Data (Patient ID: ${activeUserId}):**
    \`\`\`json
    ${JSON.stringify(patient, null, 2)}
    \`\`\`

2.  **Available Doctors & Appointments (LIVE DATA):**
    \`\`\`json
    ${JSON.stringify(doctors, null, 2)}
    \`\`\`

3.  **Symptom-to-Specialist Map:**
    \`\`\`json
    ${JSON.stringify(symptomMap, null, 2)}
    \`\`\`

**YOUR TASKS & RULES:**

1.  **Book Appointment:**
    * **Offer:** When a user asks for an appointment (e.g., "I have a cough", "I need 6 pm"), find a matching slot from the "Available Doctors" list. Offer *one* slot in your \`reply\`. **Do not set an action.**
        * User: "I have a rash."
        * You: (Finds Dr. Aisha Khan) "I found a slot with Dr. Aisha Khan, a Dermatologist, on 2025-11-16 at 9:00 AM. Would you like to book it?" (action: "None")
    * **Confirm:** When the user *confirms* a slot you just offered (e.g., "yes", "that works", "book it"), you **MUST** set \`action: "BookAppointment"\` and provide the exact \`doctorName\` and \`slotISO\` in the \`parameters\`. Your \`reply\` should be the confirmation.
        * User: "yes"
        * You: (action: "BookAppointment", parameters: { "doctorName": "Dr. Aisha Khan", "slotISO": "2025-11-16T09:00:00Z" }, reply: "Appointment confirmed! You are booked with Dr. Aisha Khan on 2025-11-16 at 9:00 AM.")
    * **Handle Rejection:** If the user rejects a slot (e.g., "no, i want 6 pm"), look for another slot in the database data that matches their new request.
        * User: "no i want an appointment around 6 pm"
        * You: (Finds Dr. Priya Gupta at 18:00) "I found another slot: Dr. Priya Gupta is free at 6:00 PM (18:00) on 2025-11-15. Would that work?" (action: "None")

2.  **Log Metric:**
    * When the user asks to log a metric (e.g., "log my bp 120/80"), you **MUST** set \`action: "LogMetric"\` and provide the \`metricType\` and \`metricValue\`.
    * Your \`reply\` should be the confirmation.
    * User: "my blood sugar was 105"
    * You: (action: "LogMetric", parameters: { "metricType": "glucose", "metricValue": "105" }, reply: "OK, logging your glucose level as 105.")

3.  **Get History:**
    * When the user asks for their history, set \`action: "GetHistory"\`.
    * Your \`reply\` should be a simple "One moment, I'll pull up your records." (The backend will override this with the real data).

**IMPORTANT**: Always respond with a valid JSON object matching the schema.
`;

        // --- 3. Call Gemini API with the full history and new prompt ---
        console.log(`Sending to Gemini: ${chatHistory[chatHistory.length - 1].parts[0].text}`);
        
        const geminiPayload = {
            contents: [
                // Start with the system prompt and database data
                {
                    role: "user",
                    parts: [{ text: systemPrompt }]
                },
                {
                    role: "model",
                    parts: [{ text: "Understood. I am Apo-Bot, ready to assist with the provided database information and perform actions." }]
                },
                // Now add the actual conversation history
                ...chatHistory
            ],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: geminiSchema,
            }
        };

        const apiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        if (!apiResponse.ok) {
            console.error("Gemini API Error:", await apiResponse.text());
            throw new Error("Gemini API request failed.");
        }

        const geminiResult = await apiResponse.json();
        const jsonText = geminiResult.candidates[0].content.parts[0].text;
        const aiResponse = JSON.parse(jsonText);
        
        console.log("Gemini Response:", aiResponse);
        return aiResponse; // Return the full JSON object (reply + action)

    } catch (err) {
        console.error('Error in AI logic:', err);
        return { reply: "I'm having a technical problem right now. Please try again later." };
    }
}


// --- 7. REST APIs ---

// --- CHAT ENDPOINT (Updated to handle actions) ---
app.post('/api/chat-reply', async (req, res) => {
    // Note: The frontend sends the *newest message* as `message` and the *full history* as `chatHistory`
    // The history already includes the newest message, so we just use `chatHistory`
    const { userId, chatHistory } = req.body;
    const activeUserId = userId || "user-nitin-123";
    
    if (!chatHistory || chatHistory.length === 0) {
        return res.status(400).json({ error: "Chat history is required." });
    }

    // 1. Get the structured response (and action) from Gemini
    const aiResponse = await getAIResponse(activeUserId, chatHistory);

    let replyText = aiResponse.reply; // Get the default reply

    try {
        // 2. Perform the action if the AI requested one
        if (aiResponse.action === 'BookAppointment') {
            const { doctorName, slotISO } = aiResponse.parameters;
            if (!doctorName || !slotISO) {
                replyText = "I'm sorry, I found a slot but missed the details. Could you please ask again?";
            } else {
                const result = await bookAppointmentInDb(doctorName, slotISO, activeUserId);
                if (!result.success) {
                    // If booking failed (e.g., slot taken), *override* the AI's reply
                    replyText = `Oh no! It looks like that slot (${doctorName} at ${slotISO}) was just taken. Please ask for another time.`;
                }
                // If booking succeeded, we just use the AI's original reply ("Appointment confirmed!")
            }
        }
        else if (aiResponse.action === 'LogMetric') {
            const { metricType, metricValue } = aiResponse.parameters;
            if (!metricType || !metricValue) {
                replyText = "I understood you want to log a metric, but I missed the details. Could you please state it again, like 'log my bp 120/80'?";
            } else {
                await logMetricInDb(metricType, metricValue, activeUserId);
                // We just use the AI's original reply ("OK, logging your glucose...")
            }
        }
        else if (aiResponse.action === 'GetHistory') {
            const patient = await Patient.findOne({ userId: activeUserId });
            if (!patient) {
                replyText = "I don't have any medical history for you.";
            } else {
                replyText = `Here's what I have for your medical history:\n- Allergies: ${patient.allergies.join(', ') || 'None'}\n- Conditions: ${patient.conditions.join(', ') || 'None'}\n- Medications: ${patient.medications.join(', ') || 'None'}`;
            }
        }

        // 3. Send the final, correct reply to the user
        res.json({ reply: replyText });

    } catch (err) {
        console.error("Error in /api/chat-reply action handler:", err);
        res.status(500).json({ reply: "I had an error trying to complete that action. Please try again." });
    }
});


// "Hello World" test endpoint
app.get('/api/hello', (req, res) => {
    res.json({ message: "Hello World! The backend is working!" });
});

// --- Booking Page API ---
app.post('/api/analyze-symptoms', async (req, res) => {
    try {
        const { symptoms } = req.body;
        if (!symptoms) return res.status(400).json({ error: 'Symptoms are required' });

        let foundSpecialty = 'General Physician';
        const lowerSymptoms = symptoms.toLowerCase();

        const mappings = await SymptomMap.find();
        for (const mapping of mappings) {
            if (lowerSymptoms.includes(mapping.symptom)) {
                foundSpecialty = mapping.specialist;
                break;
            }
        }
        
        const doctors = await Doctor.find({ specialization: foundSpecialty });
        res.json({ specialty: foundSpecialty, doctors: doctors });

    } catch (err) {
        console.error("Error in /api/analyze-symptoms:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/book-appointment', async (req, res) => {
    try {
        const userId = "user-nitin-123"; 
        const { doctorName, specialty, date, time, slotISO } = req.body;

        // Use our new refactored function
        const result = await bookAppointmentInDb(doctorName, slotISO, userId);

        if (!result.success) {
            return res.status(409).json({ error: result.error }); // 409 Conflict (slot taken)
        }
        
        res.status(201).json({ message: 'Appointment booked successfully!', appointment: result.appointment });
    } catch (err) {
        console.error("Error in /api/book-appointment:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- Medical History Page API ---
app.get('/api/medical-history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const patient = await Patient.findOne({ userId });
        if (!patient) return res.status(404).json({ error: 'Patient not found' });
        res.json(patient);
    } catch (err) {
        console.error("Error in /api/medical-history (GET):", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/medical-history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { type, entry } = req.body; 

        let update;
        if (type === 'allergy') update = { $push: { allergies: entry.name } };
        else if (type === 'medication') update = { $push: { medications: `${entry.name} - ${entry.dosage}` } };
        else if (type === 'condition') update = { $push: { conditions: entry.name } };
        else return res.status(400).json({ error: 'Invalid entry type' });

        const updatedPatient = await Patient.findOneAndUpdate({ userId }, update, { new: true, upsert: true });
        res.json(updatedPatient);
    } catch (err) {
        console.error("Error in /api/medical-history (POST):", err);
        res.status(500).json({ error: err.message });
    }
});

// --- Health Tracker Page API ---
app.get('/api/health-tracker/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const records = await HealthTracker.find({ 
            userId,
            date: { $gte: new Date(new Date().setDate(new Date().getDate() - 30)) } // Last 30 days
        }).sort({ date: 'asc' });
        res.json(records);
    } catch (err) {
        console.error("Error in /api/health-tracker (GET):", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/health-tracker/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { type, value, date } = req.body;
        
        // Use our new refactored function
        const result = await logMetricInDb(type, value, userId);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        
        res.status(201).json({ message: "Metric logged" });
    } catch (err) {
        console.error("Error in /api/health-tracker (POST):", err);
        res.status(500).json({ error: err.message });
    }
});

// --- Chat Panel API (for medical_history_page.html) ---
app.post('/api/chat-command', async (req, res) => {
    try {
        const { message, userId } = req.body;
        const lower = message.toLowerCase();
        let responseText = "I can help you add or remove allergies, medications, or conditions. Could you please be more specific?";

        if (lower.includes('add allergy to')) {
            const item = lower.split('add allergy to')[1].trim();
            await Patient.updateOne({ userId }, { $push: { allergies: item } });
            responseText = `✅ I've added ${item} to your allergy records.`;
        } else if (lower.includes('add medication')) {
            const item = lower.split('add medication')[1].trim();
            await Patient.updateOne({ userId }, { $push: { medications: item } });
            responseText = `✅ Medication ${item} added to your list.`;
        }
        
        res.json({ reply: responseText });
    } catch (err) {
        console.error("Error in /api/chat-command:", err);
        res.status(500).json({ error: err.message });
    }
});


// --- Tele-consultation Page API ---
app.get('/api/doctors/online', async (req, res) => {
    try {
        const doctors = await Doctor.find().sort({ status: 'asc' }); 
        res.json(doctors);
    } catch (err) {
        console.error("Error in /api/doctors/online:", err);
        res.status(500).json({ error: err.message });
    }
});


// --- 8. START SERVER ---
app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
    console.log("Make sure your local MongoDB is running!");
});