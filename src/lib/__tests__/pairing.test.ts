import { buildConnection, parsePairingInput, parseQuery } from '../pairing';

describe('parseQuery', () => {
	it('decodes percent-encoded keys and values', () => {
		expect(parseQuery('url=http%3A%2F%2F10.0.0.2%3A39231&token=abc')).toEqual({
			url: 'http://10.0.0.2:39231',
			token: 'abc',
		});
	});

	it('keeps empty values instead of dropping the key', () => {
		expect(parseQuery('workspace=&token=x')).toEqual({ workspace: '', token: 'x' });
	});
});

describe('parsePairingInput', () => {
	it('reads the orchestra://pair link the IDE copies', () => {
		const uri = 'orchestra://pair?v=1&url=http%3A%2F%2F192.168.0.5%3A39231&token=tok123&workspace=Orchestra';
		expect(parsePairingInput(uri)).toEqual({
			url: 'http://192.168.0.5:39231',
			token: 'tok123',
			label: 'Orchestra',
		});
	});

	it('reads a JSON payload (QR code contents)', () => {
		const json = JSON.stringify({ v: 1, url: 'http://10.1.1.7:39231', token: 'tok', workspace: 'demo' });
		expect(parsePairingInput(json)).toEqual({ url: 'http://10.1.1.7:39231', token: 'tok', label: 'demo' });
	});

	it('reads a plain URL that carries the token as a query param', () => {
		expect(parsePairingInput('http://10.1.1.7:39231?token=abc')).toEqual({
			url: 'http://10.1.1.7:39231',
			token: 'abc',
			label: '10.1.1.7:39231',
		});
	});

	it('falls back to the host as the label when workspace is missing', () => {
		const parsed = parsePairingInput('orchestra://pair?url=http%3A%2F%2F10.0.0.9%3A39231&token=t');
		expect(parsed?.label).toBe('10.0.0.9:39231');
	});

	it('rejects input without a token', () => {
		expect(parsePairingInput('orchestra://pair?url=http%3A%2F%2F10.0.0.9%3A39231')).toBeNull();
		expect(parsePairingInput('')).toBeNull();
		expect(parsePairingInput('not a link')).toBeNull();
		expect(parsePairingInput('{broken json')).toBeNull();
	});
});

describe('buildConnection', () => {
	it('adds the default port when only a host is given', () => {
		expect(buildConnection('192.168.0.5', 'tok')).toEqual({
			url: 'http://192.168.0.5:39231',
			token: 'tok',
			label: '192.168.0.5:39231',
		});
	});

	it('keeps an explicit port and scheme', () => {
		expect(buildConnection('http://localhost:8080', 'tok')?.url).toBe('http://localhost:8080');
	});

	it('requires both a host and a token', () => {
		expect(buildConnection('', 'tok')).toBeNull();
		expect(buildConnection('host', '  ')).toBeNull();
	});
});
