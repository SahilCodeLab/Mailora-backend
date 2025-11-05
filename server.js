import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Simple CORS
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

        // Agar API key nahi hai toh fallback use karo
        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            console.log('Using fallback email generation');
            const fallbackEmail = createFallbackEmail(recipientName, finalSubject, tone, personalNote, language, length);
            return res.json({
                success: true,
                email: fallbackEmail,
                metadata: {
                    note: 'Fallback email - Add Gemini API key'
                }
            });
        }

        // Gemini API call
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

// Gemini API Integration
async function generateWithGemini(recipientName, subject, tone, personalNote, length, language, apiKey) {
    const prompt = createEmailPrompt(recipientName, subject, tone, personalNote, length, language);
    
    console.log('🚀 Calling Gemini API...');
    
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
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
                    maxOutputTokens: 1000,
                }
            })
        }
    );

    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Invalid response from Gemini');
    }

    console.log('✅ Email generated successfully');
    return data.candidates[0].content.parts[0].text;
}

function createEmailPrompt(recipientName, subject, tone, personalNote, length, language) {
    return `
Create a professional email in ${language} with these details:

RECIPIENT: ${recipientName || 'Customer'}
SUBJECT: ${subject}
TONE: ${tone}
PERSONAL NOTE: ${personalNote || 'None'}

Generate a professional email that sounds human and natural.
Start with "Subject: ${subject}"
Use appropriate greeting and closing.
Make it ${length} length.
`;
}

function createFallbackEmail(recipientName, subject, tone, personalNote, language, length) {
    const templates = {
        'en': `Subject: ${subject}\n\nDear ${recipientName || 'Customer'},\n\nI hope this email finds you well.\n\n${personalNote ? personalNote + '\n\n' : ''}Thank you for your time and consideration.\n\nBest regards,\n[Your Name]`,
        'hi': `विषय: ${subject}\n\nप्रिय ${recipientName || 'ग्राहक'},\n\nमुझे आशा है कि यह ईमेल आपको अच्छी तरह मिलेगा।\n\n${personalNote ? personalNote + '\n\n' : ''}आपके समय और विचार के लिए धन्यवाद।\n\nसादर,\n[आपका नाम]`
    };

    return templates[language] || templates['en'];
}

// Root route
app.get('/', (req, res) => {
    res.json({
        message: 'Mailora Email Generator API',
        status: 'running',
        endpoints: ['/health', '/generate-email']
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
