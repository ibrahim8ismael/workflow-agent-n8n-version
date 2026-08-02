import { Injectable } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

@Injectable()
export class HttpService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 30000,
    });
  }

  getClient(): AxiosInstance {
    return this.client;
  }
}
