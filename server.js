import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Google AI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  res.json({ 
    status: 'OK', 
    message: 'Mailora API is running',
    apiKeyConfigured: !!apiKey && apiKey !== 'your_gemini_api_key_here',
    geminiModel: 'gemini-2.0-flash-exp',
    timestamp: new Date().toISOString()
  });
});

// Test Gemini API
app.get('/test-gemini', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.json({
        success: false,
        error: 'API key not configured'
      });
    }

    console.log('Testing Gemini API...');
    
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: "Write a short test message saying hello.",
    });

    res.json({
      success: true,
      message: 'Gemini API is working!',
      response: response.text
    });

  } catch (error) {
    console.error('Test error:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Email Generation Endpoint
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

    // Check if API key is configured
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      console.log('Using fallback email generation - API key not set');
      const fallbackEmail = createFallbackEmail(recipientName, finalSubject, tone, personalNote, language, length);
      return res.json({
        success: true,
        email: fallbackEmail,
        metadata: {
          note: 'Fallback email - Please set GEMINI_API_KEY'
        }
      });
    }

    console.log('Generating email with Gemini...');
    
    // Generate email using new Google AI SDK
    const emailContent = await generateWithGeminiAI(
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
        generatedAt: new Date().toISOString(),
        model: 'gemini-2.0-flash-exp'
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Fallback email
    const fallbackEmail = createFallbackEmail(
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

// New Gemini AI Integration using @google/genai
async function generateWithGeminiAI(recipientName, subject, tone, personalNote, length, language) {
  const prompt = createEmailPrompt(recipientName, subject, tone, personalNote, length, language);
  
  console.log('🚀 Calling Gemini 2.0 Flash...');
  
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-exp",
    contents: prompt,
  });

  console.log('✅ Email generated successfully');
  return response.text;
}

function createEmailPrompt(recipientName, subject, tone, personalNote, length, language) {
  const lengthMap = {
    'short': '3-4 sentences',
    'medium': '5-7 sentences', 
    'long': '8-10 sentences'
  };

  const languageMap = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French', 
    'de': 'German',
    'hi': 'Hindi',
    'ja': 'Japanese',
    'zh': 'Chinese',
    'ar': 'Arabic',
    'pt': 'Portuguese',
    'ru': 'Russian'
  };

  return `
Create a professional email in ${languageMap[language] || 'English'} with these details:

RECIPIENT: ${recipientName || 'Customer'}
SUBJECT: ${subject}
TONE: ${tone}
LENGTH: ${lengthMap[length]}
LANGUAGE: ${languageMap[language] || 'English'}
${personalNote ? `ADDITIONAL CONTEXT: ${personalNote}` : ''}

Requirements:
- Start with "Subject: ${subject}"
- Use appropriate greeting and closing
- Maintain ${tone} tone throughout
- Sound natural and human-like
- Be professional for business communication
- Include the additional context if provided
- Use proper formatting with line breaks

Generate only the email content without any explanations.
`;
}

function createFallbackEmail(recipientName, subject, tone, personalNote, language, length) {
  const templates = {
    'en': `Subject: ${subject}\n\nDear ${recipientName || 'Customer'},\n\nI hope this email finds you well.\n\n${personalNote ? personalNote + '\n\n' : ''}Thank you for your time and consideration.\n\nBest regards,\n[Your Name]`,
    'hi': `विषय: ${subject}\n\nप्रिय ${recipientName || 'ग्राहक'},\n\nमुझे आशा है कि यह ईमेल आपको अच्छी तरह मिलेगा।\n\n${personalNote ? personalNote + '\n\n' : ''}आपके समय और विचार के लिए धन्यवाद।\n\nसादर,\n[आपका नाम]`,
    'es': `Asunto: ${subject}\n\nEstimado/a ${recipientName || 'Cliente'},\n\nEspero que este correo le encuentre bien.\n\n${personalNote ? personalNote + '\n\n' : ''}Gracias por su tiempo y consideración.\n\nAtentamente,\n[Su Nombre]`
  };

  return templates[language] || templates['en'];
}

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Mailora Email Generator API',
    status: 'running',
    endpoints: {
      health: '/health',
      test: '/test-gemini',
      generate: '/generate-email (POST)'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Mailora Backend Started!
📍 Port: ${PORT}
🤖 Using: @google/genai SDK
✨ Model: gemini-2.0-flash-exp
🌐 CORS Enabled: All origins
✅ Health Check: /health
🔧 Test API: /test-gemini
  `);
});
