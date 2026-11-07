/**
 * Where the .division documents come from: the PC's Orchestra (remote control, GET /api/documents) or a cloud
 * session's sandbox (Division API, GET /api/cloud-sessions/:id/documents). Both answer in the same shape, so
 * DocumentList / DocumentSheet show and edit either with the same screens — the cloud agent's paper,
 * specification, design and workflow are opened and edited just like the ones the PC's agent writes.
 */

import { useMemo } from 'react';
import { OrchestraApiError } from '../api/client';
import type { RemoteDocument, RemoteDocumentContent } from '../api/types';
import { DivisionCloudError, cloudErrorText, getCloudDocument, listCloudDocuments, saveCloudDocument } from './divisionCloud';
import type { DivisionSession } from './divisionAuth';
import { useApp } from '../state/AppContext';

export type DocumentSource = {
	/** Where the documents live, for messages: 'PC' / 'クラウド' */
	where: string;
	list(): Promise<{ documents: RemoteDocument[]; revision: number }>;
	get(path: string): Promise<RemoteDocumentContent>;
	/** baseMtime: the mtime the document was opened at. A newer file is a conflict (isConflict) */
	save(path: string, content: string, baseMtime?: number): Promise<RemoteDocumentContent>;
	/** Moves when the documents may have changed: the list and an open document are read again */
	revision?: number;
	isConflict(e: unknown): boolean;
	errorText(e: unknown): string;
	/** After a save (e.g. refresh the PC's snapshot) */
	onSaved?(): void;
};

/** The PC's documents (needs the remote-control connection). */
export const usePcDocumentSource = (): DocumentSource | null => {
	const { client, snapshot, invalidate } = useApp();
	const revision = snapshot?.documentsRevision;
	return useMemo(() => (client ? {
		where: 'PC',
		list: () => client.listDocuments(),
		get: (path: string) => client.getDocument(path),
		save: (path: string, content: string, baseMtime?: number) => client.saveDocument(path, content, baseMtime),
		revision,
		isConflict: (e: unknown) => e instanceof OrchestraApiError && e.status === 409,
		errorText: (e: unknown) => (e instanceof OrchestraApiError
			? (e.status === 404 ? 'この PC の Orchestra は文書の表示に対応していません。Orchestra を更新してください。' : e.userMessage)
			: String(e)),
		onSaved: invalidate,
	} : null), [client, revision, invalidate]);
};

/** Error codes whose server message is the best explanation (Japanese, from Division). */
const DOCUMENT_CODES = new Set(['not_a_document', 'file_not_found', 'document_too_large', 'invalid_workflow', 'invalid_document', 'no_sandbox', 'is_a_directory']);

/** A cloud session's documents (in its sandbox). revision: anything that moves when the agent works, e.g. lastSeq. */
export const cloudDocumentSource = (auth: DivisionSession, sessionId: string, revision?: number): DocumentSource => ({
	where: 'クラウド',
	list: () => listCloudDocuments(auth, sessionId),
	get: path => getCloudDocument(auth, sessionId, path),
	save: (path, content, baseMtime) => saveCloudDocument(auth, sessionId, path, content, baseMtime),
	revision,
	isConflict: e => e instanceof DivisionCloudError && e.status === 409 && e.code === 'document_changed',
	errorText: e => {
		if (e instanceof DivisionCloudError && e.code && DOCUMENT_CODES.has(e.code)) return e.message;
		if (e instanceof DivisionCloudError && e.status === 404) return 'この Division サーバーはクラウドの文書に未対応か、セッションが見つかりません。';
		return cloudErrorText(e);
	},
});
