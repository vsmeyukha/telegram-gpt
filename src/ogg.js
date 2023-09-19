import axios from "axios";
import Ffmpeg from "fluent-ffmpeg";
import installer from '@ffmpeg-installer/ffmpeg';
import { createWriteStream } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { removeFile } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));


class OggConverter {
  constructor() {
    Ffmpeg.setFfmpegPath(installer.path);  
  }

  toMp3(input, output) {
    try {
      const outputPath = resolve(dirname(input), `${output}.mp3`);
      return new Promise((resolve, reject) => {
        Ffmpeg(input)
          .inputOption('-t 600')
          .output(outputPath)
          .on('end', () => {
            resolve(outputPath);
            removeFile(input);
            console.log('convesion completed');
          })
          .on('error', e => reject(e.message))
          .run();
      })
    } catch (e) {
      console.log(`error while ogg to mp3: ${e}`);
    }
  }

  async create(url, filename) {
    try {
      const oggPath = resolve(__dirname, '../voices', `${filename}.ogg`);
      const response = await axios.get(url, {
        responseType: 'stream',
      });

      return new Promise(resolve => {
        const stream = createWriteStream(oggPath);
        response.data.pipe(stream);
        stream.on('finish', () => resolve(oggPath));
      });
      } catch (e) {
        console.log(`error while downloading ogg file: ${e}`);
    }
  }
}

export async function saveUploadedFile(url, filename) {
  try {
    const filePath = resolve(__dirname, '../uploadedFiles', filename);
    const response = await axios.get(url, {
      responseType: 'stream',
    });

    return new Promise(resolve => {
      const stream = createWriteStream(filePath);
      response.data.pipe(stream);
      stream.on('finish', () => resolve(filePath));
    });
    } catch (e) {
      console.log(`error while downloading ogg file: ${e}`);
  }
}

export const ogg = new OggConverter();