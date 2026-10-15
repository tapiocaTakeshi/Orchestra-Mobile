import test from 'node:test';
import assert from 'node:assert/strict';
import {
  versionFromTag,
  validateMetadata,
  pickTargetVersion,
  pickLocales,
} from '../scripts/app-store-metadata.mjs';

const sample = {
  description: 'Orchestra Mobile lets you work with Orchestra IDE.',
  keywords: 'orchestra,ide,remote,ai',
  promotionalText: 'Access Orchestra from your phone.',
  whatsNew: 'Improved the mobile interface.',
  subtitle: 'Orchestra on your phone',
};

test('GitHub Release version tags must be App Store version numbers', () => {
  assert.equal(versionFromTag('v0.1.0'), '0.1.0');
  assert.equal(versionFromTag('1.2'), '1.2');
  assert.throws(() => versionFromTag('v1.2.3-beta.1'));
  assert.throws(() => versionFromTag('release-next'));
});

test('AI metadata fields must exist and obey App Store limits', () => {
  assert.deepEqual(validateMetadata(sample), sample);
  assert.throws(() => validateMetadata({ ...sample, subtitle: 'x'.repeat(31) }), /limit/);
  assert.throws(() => validateMetadata({ ...sample, keywords: 'x'.repeat(101) }), /limit/);
  assert.throws(() => validateMetadata({ ...sample, description: '' }), /missing/);
  assert.throws(() => validateMetadata({ ...sample, description: 'TODO: fill later' }), /Placeholder/);
});

test('Only the matching editable iOS version may be changed', () => {
  const ready = { id: 'ios-1', attributes: { platform: 'IOS', versionString: '1.0.0', appVersionState: 'PREPARE_FOR_SUBMISSION' } };
  const live = { id: 'ios-2', attributes: { platform: 'IOS', versionString: '0.9.0', appVersionState: 'READY_FOR_DISTRIBUTION' } };
  assert.equal(pickTargetVersion([live, ready], '1.0.0'), ready);
  assert.throws(() => pickTargetVersion([live, ready], '0.9.0'), /not editable/);
  assert.throws(() => pickTargetVersion([live, ready], '1.1.0'), /different editable/);
  assert.equal(pickTargetVersion([live], '1.1.0'), null);
});

test('Locales are chosen only from Apple existing locales', () => {
  const items = [{ attributes: { locale: 'en-US' } }, { attributes: { locale: 'ja' } }];
  assert.deepEqual(pickLocales(items, 'en-US'), ['ja', 'en-US']);
  assert.deepEqual(pickLocales([{ attributes: { locale: 'fr-FR' } }], 'fr-FR'), ['fr-FR']);
  assert.deepEqual(pickLocales([], 'en-US'), []);
});
