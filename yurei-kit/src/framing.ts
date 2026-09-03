/** Chrome native messaging framing: 4-byte little-endian length followed by UTF-8 JSON. Used on both local hops. */
export const encodeFrame = (message: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
};

export class FrameParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + length) break;
      const body = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      try {
        messages.push(JSON.parse(body));
      } catch {
        // A corrupt frame is dropped; the next one re-synchronises because lengths are explicit.
      }
    }
    return messages;
  }
}
