import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(compression());
app.use(morgan('combined'));
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '10mb' }));

const emailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Mailora API is running',
        timestamp: new Date().toISOString()
    });
});

app.post('/generate-email', emailLimiter, async (req, res) => {
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

        if (!apiKey) {
            console.log('Using fallback email generation');
            const fallbackEmail = createFallbackEmail(recipientName, finalSubject, tone, personalNote, language, length);
            return res.json({
                success: true,
                email: fallbackEmail,
                metadata: {
                    note: 'Fallback email (API key not set)'
                }
            });
        }

        const emailContent = await generateWithGemini(
            recipientName, 
            finalSubject, 
            tone, 
            personalNote, 
            length, 
            language,
            apiKey
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
        console.error('❌ Error:', error);
        
        const fallbackEmail = createFallbackEmail(
            req.body.recipientName, 
            req.body.subject || req.body.purpose, 
            req.body.tone, 
            req.body.personalNote, 
            req.body.language, 
            req.body.length
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

async function generateWithGemini(recipientName, subject, tone, personalNote, length, language, apiKey) {
    const prompt = createEmailPrompt(recipientName, subject, tone, personalNote, length, language);
    
    console.log('🚀 Calling Gemini 1.5 Flash API...');
    
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: getMaxTokens(length),
                }
            })
        }
    );

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Invalid response from Gemini');
    }

    return data.candidates[0].content.parts[0].text;
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

function getMaxTokens(length) {
    const tokenMap = {
        'short': 800,
        'medium': 1200,
        'long': 1800
    };
    return tokenMap[length] || 1200;
}

app.get('/', (req, res) => {
    res.json({
        message: 'Mailora Email Generator API',
        endpoints: {
            health: '/health',
            generateEmail: '/generate-email (POST)'
        },
        status: 'running'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🚀 Mailora Backend Started!
📍 Port: ${PORT}
📧 Email Generation API Ready
🌐 CORS Enabled: All origins
✅ Health Check: /health
    `);
});

export default app;
