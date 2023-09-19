import { Configuration, OpenAIApi } from "openai";
import {createReadStream} from 'fs';
import config from 'config';

class OpenAI {
  constructor(apiKey) {
    const configuration = new Configuration({
      apiKey
    });
    this.openai = new OpenAIApi(configuration);
  }

  roles = {
    ASSISTANT: 'assistant',
    USER: 'user',
    SYSTEM: 'system',
  }

  async chat(messages) {
    try {
      const response = await this.openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages,
      });

      return response.data.choices[0].message;
    } catch (e) {
      console.log(`Error with ChatGPT: ${e}`);
    }
  }

  async transcription(mp3Path) {
    try {
      const response = await this.openai.createTranscription(createReadStream(mp3Path), 'whisper-1');
      return response.data.text;
    } catch (e) {
      console.log(`error while transcribing audio into text: ${e}`);
    }
  }
}

export const openai = new OpenAI(config.get('OPENAI_API_KEY'));