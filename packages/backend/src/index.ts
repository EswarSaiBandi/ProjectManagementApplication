import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(bodyParser.json());

app.get('/', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'Project Studio Backend' });
});

// Mock Transcription Route
app.post('/api/transcribe', async (req: Request, res: Response) => {
    try {
        const { audioUrl } = req.body;
        console.log(`[Mock] Received audio for transcription: ${audioUrl}`);

        // Simulate AI processing delay (2 seconds)
        await new Promise(resolve => setTimeout(resolve, 2000));

        res.json({
            transcript: "This is a mock translation. The audio was received successfully!",
            audioUrl: audioUrl,
            status: 'completed'
        });
    } catch (error) {
        console.error('Error processing transcription:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
