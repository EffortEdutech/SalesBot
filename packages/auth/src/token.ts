import { createHash, randomBytes } from 'node:crypto';
export const generateBridgeToken = () => `brg_${randomBytes(32).toString('base64url')}`;
export const hashBridgeToken = (token: string, pepper: string) =>
  createHash('sha256').update(`${pepper}:${token}`, 'utf8').digest('hex');
