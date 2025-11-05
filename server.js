import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Mailora API is running',
    timestamp: new Date().toISOString()
  });
});

// Email Generation Endpoint - HUMAN-LIKE
app.post('/generate-email', async (req, res) => {
  try {
    console.log('📧 Email generation request received');
    
    const { recipientName, subject, tone, personalNote, length, language, purpose } = req.body;

    if (!subject && !purpose) {
      return res.status(400).json({ 
        success: false,
        error: 'Email subject or purpose is required' 
      });
    }

    const finalSubject = subject || purpose;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      console.log('Using fallback email generation');
      const fallbackEmail = createHumanLikeFallbackEmail(recipientName, finalSubject, tone, personalNote, language, length);
      return res.json({
        success: true,
        email: fallbackEmail,
        metadata: {
          note: 'Fallback email'
        }
      });
    }

    console.log('Generating human-like email...');
    
    const emailContent = await generateHumanLikeEmail(
      recipientName, 
      finalSubject, 
      tone, 
      personalNote, 
      length, 
      language
    );

    res.json({ 
      success: true,
      email: emailContent,
      metadata: {
        language: language || 'en',
        tone: tone || 'Professional',
        length: length || 'medium',
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    const fallbackEmail = createHumanLikeFallbackEmail(
      req.body.recipientName || '[Recipient Name]', 
      req.body.subject || req.body.purpose || 'Email', 
      req.body.tone || 'Professional', 
      req.body.personalNote || '', 
      req.body.language || 'en', 
      req.body.length || 'medium'
    );
    
    res.json({
      success: true,
      email: fallbackEmail,
      metadata: {
        note: 'Generated using fallback method'
      }
    });
  }
});

// HUMAN-LIKE Email Generation
async function generateHumanLikeEmail(recipientName, subject, tone, personalNote, length, language) {
  const prompt = createHumanLikePrompt(recipientName, subject, tone, personalNote, length, language);
  
  console.log('🚀 Generating human-like email...');
  
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-exp",
    contents: prompt,
    generationConfig: {
      temperature: 0.9, // Higher temperature for more creativity
      topK: 40,
      topP: 0.95,
    }
  });

  console.log('✅ Human-like email generated');
  return response.text;
}

function createHumanLikePrompt(recipientName, subject, tone, personalNote, length, language) {
  const lengthMap = {
    'short': 'brief (3-4 sentences)',
    'medium': 'moderate (5-7 sentences)', 
    'long': 'detailed (8-10 sentences)'
  };

  return `
IMPORTANT: Write this email to sound completely HUMAN and NATURAL. Avoid AI patterns.

Create a ${lengthMap[length]} email in ${language} with this context:

SUBJECT: ${subject}
RECIPIENT: ${recipientName || 'the recipient'}
TONE: ${tone}
CONTEXT: ${personalNote || 'General professional communication'}

CRITICAL INSTRUCTIONS FOR HUMAN-LIKE WRITING:
1. Use natural language with slight imperfections
2. Include conversational phrases and filler words occasionally
3. Vary sentence length - mix short and long sentences
4. Use contractions (I'm, don't, can't) where appropriate
5. Add personal touches and specific details
6. Avoid perfect grammar occasionally for authenticity
7. Use industry-specific jargon naturally
8. Include subtle emotional cues
9. Make it sound like a real person wrote it
10. Add a personal sign-off that matches the tone

SPECIFIC TECHNIQUES TO AVOID AI DETECTION:
- Start with a personal reference if possible
- Use colloquial language appropriate for the tone
- Include minor details that make it specific
- Add a brief personal anecdote or reference
- Use slightly varied vocabulary
- Include transitional phrases naturally

Email structure:
Subject: ${subject}

[Body with natural flow]

[Authentic closing]

Write ONLY the email content without any explanations.
`;
}

function createHumanLikeFallbackEmail(recipientName, subject, tone, personalNote, language, length) {
  // Human-written templates that pass AI detection
  const templates = {
    'en': {
      professional: `Subject: ${subject}

Hi ${recipientName || 'there'},

Hope you're doing well. ${personalNote ? personalNote + ' ' : ''}I wanted to quickly touch base about this.

Looking forward to hearing your thoughts when you get a moment. Let me know if you need any clarification from my end.

Best,
[Your Name]`,

      casual: `Subject: ${subject}

Hey ${recipientName || 'there'},

Hope you're having a good week! ${personalNote ? personalNote + ' ' : ''}Just wanted to follow up on this.

When you get a chance, could you take a look? No major rush, but would appreciate your input.

Thanks,
[Your Name]`,

      friendly: `Subject: ${subject}

Hello ${recipientName || 'there'},

Hope all is well on your end! ${personalNote ? personalNote + ' ' : ''}I was thinking about this and wanted to reach out.

Let me know what you think when you have some time. Would love to catch up properly soon!

Cheers,
[Your Name]`
    },
    'hi': {
      professional: `विषय: ${subject}

प्रिय ${recipientName || 'सर/मैडम'},

आशा है आप सभी ठीक हैं। ${personalNote ? personalNote + ' ' : ''}मैं इस बारे में आपसे संपर्क करना चाहता था/चाहती थी।

आपके विचारों की प्रतीक्षा रहेगी। यदि कोई स्पष्टीकरण चाहिए हो तो बताएं।

धन्यवाद,
[आपका नाम]`,

      casual: `विषय: ${subject}

नमस्ते ${recipientName || 'भाई/दोस्त'},

कैसे हो? ${personalNote ? personalNote + ' ' : ''}बस इस बारे में एक अपडेट देने के लिए मैसेज कर रहा/रही हूं।

जब भी समय मिले, जरूर बताएं। कोई जल्दी नहीं है।

शुक्रिया,
[आपका नाम]`
    }
  };

  const langTemplates = templates[language] || templates['en'];
  const toneTemplate = langTemplates[tone.toLowerCase()] || langTemplates.professional;
  
  return toneTemplate;
}

app.get('/', (req, res) => {
  res.json({
    message: 'Mailora Human-like Email Generator',
    status: 'running',
    features: 'AI detection bypass techniques included'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Mailora Backend Started!
📍 Port: ${PORT}
🤖 Human-like Email Generation
✨ Bypasses AI detection
🌐 CORS Enabled
✅ Ready to use
  `);
});
