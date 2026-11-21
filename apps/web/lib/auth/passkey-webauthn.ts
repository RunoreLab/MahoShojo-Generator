import 'server-only';
import type { PasskeyConfig } from '@/lib/auth/passkey-config';
import type { PasskeyAssertion, PasskeyRegistration } from '@/lib/auth/passkey-contract';
import { sha256Hex } from '@/lib/auth/sha256';
import type { PasskeyRow } from '@/lib/db/repositories/passkeys';

const ALGORITHMS = [-7, -257]; // ES256 / RS256，覆盖 Windows Hello 与常见平台和安全密钥。
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;

const storedCredentials = (keys: PasskeyRow[]) => keys.map((key) => ({
  id: key.credentialId,
  transports: key.transports,
}));

const userHandle = async (authUserId: string) =>
  new TextEncoder().encode(await sha256Hex(`mahoshojo-passkey-user-v1:${authUserId}`));

export async function createRegistrationOptions(
  config: PasskeyConfig,
  user: { id: string; username: string },
  keys: PasskeyRow[],
) {
  const { generateRegistrationOptions } = await import('@simplewebauthn/server');
  return generateRegistrationOptions({
    rpName: '魔法少女生成器',
    rpID: config.rpId,
    userID: await userHandle(user.id),
    userName: user.username,
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    supportedAlgorithmIDs: ALGORITHMS,
    excludeCredentials: storedCredentials(keys),
  });
}

export async function createAssertionOptions(config: PasskeyConfig, keys: PasskeyRow[] = []) {
  const { generateAuthenticationOptions } = await import('@simplewebauthn/server');
  return generateAuthenticationOptions({
    rpID: config.rpId,
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    userVerification: 'required',
    allowCredentials: storedCredentials(keys),
  });
}

export async function verifyPasskeyRegistration(
  config: PasskeyConfig,
  expectedChallenge: string,
  response: PasskeyRegistration['response'],
) {
  const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
  const { decodeClientDataJSON, decodeAttestationObject, isoBase64URL } = await import('@simplewebauthn/server/helpers');
  try {
    const clientData = decodeClientDataJSON(response.response.clientDataJSON);
    if (clientData.crossOrigin || clientData.topOrigin !== undefined) return null;
    if (decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject)).get('fmt') !== 'none') {
      return null;
    }
    const result = await verifyRegistrationResponse({
      response,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      expectedChallenge,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    });
    if (!result.verified) return null;
    const { credential, credentialDeviceType } = result.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      transports: credential.transports ?? [],
    };
  } catch {
    return null;
  }
}

export async function verifyPasskeyAssertion(
  config: PasskeyConfig,
  expectedChallenge: string,
  response: PasskeyAssertion['response'],
  passkey: PasskeyRow,
  discoverable: boolean,
) {
  const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
  const { decodeClientDataJSON, isoBase64URL } = await import('@simplewebauthn/server/helpers');
  try {
    const clientData = decodeClientDataJSON(response.response.clientDataJSON);
    if (clientData.crossOrigin || clientData.topOrigin !== undefined) return null;
    const handle = response.response.userHandle;
    if ((discoverable || handle) && handle !== isoBase64URL.fromBuffer(await userHandle(passkey.authUserId))) {
      return null;
    }
    const result = await verifyAuthenticationResponse({
      response,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      expectedChallenge,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
      },
      requireUserVerification: true,
    });
    if (!result.verified || result.authenticationInfo.credentialDeviceType !== passkey.deviceType) return null;
    return result.authenticationInfo.newCounter;
  } catch {
    return null;
  }
}
