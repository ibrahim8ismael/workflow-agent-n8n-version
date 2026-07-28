export interface UploadFile {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}

export interface FileResult {
  key: string;
  url: string;
  etag?: string;
}

export interface FileItem {
  key: string;
  size: number;
  lastModified: Date;
}

export interface StorageAdapter {
  upload(file: UploadFile): Promise<FileResult>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getUrl(key: string): Promise<string>;
  list(prefix: string): Promise<FileItem[]>;
}
