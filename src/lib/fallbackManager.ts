import type { RawOpenRouterModel, FallbackAuditLog } from '../types';
import { type ExecutionPolicy, assertPolicyModel, isFreeModelId } from './executionPolicy';
import { saveAuditLogToFirestore } from './persistence';

export class FallbackManager {
  private auditLog: FallbackAuditLog[] = [];

  public logAttempt(attempt: FallbackAuditLog) {
    this.auditLog.push(attempt);
    // Push audit logs directly to Cloud Firestore
    saveAuditLogToFirestore(attempt).catch((e) => {
      console.warn('[FallbackManager] Error pushing audit log to Firestore:', e);
    });
  }

  public getAuditLog(): FallbackAuditLog[] {
    return [...this.auditLog];
  }

  public clearAuditLog() {
    this.auditLog = [];
  }

  public computeOrderedBackupList(
    originalModel: string,
    policy: ExecutionPolicy,
    catalog: RawOpenRouterModel[] = []
  ): string[] {
    assertPolicyModel(originalModel, policy, catalog);

    const isFreeOnly = policy.budget === 'free';
    const candidates = catalog
      .map((m) => m.id)
      .filter((id) => id !== originalModel)
      .filter((id) => {
        if (isFreeOnly) {
          return isFreeModelId(id, catalog);
        }
        return true;
      });

    return candidates;
  }

  public async executeWithFallback<T>(
    model: string,
    policy: ExecutionPolicy,
    catalog: RawOpenRouterModel[],
    action: (targetModel: string) => Promise<T>,
    sessionId?: string
  ): Promise<T> {
    assertPolicyModel(model, policy, catalog);

    try {
      return await action(model);
    } catch (primaryError: any) {
      this.logAttempt({
        id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        originalModel: model,
        attemptedModel: model,
        error: primaryError.message || String(primaryError),
        timestamp: Date.now(),
        sessionId,
      });

      if (!policy.allowProviderFallback) {
        throw primaryError;
      }

      const backups = this.computeOrderedBackupList(model, policy, catalog);
      for (const backupModel of backups) {
        try {
          assertPolicyModel(backupModel, policy, catalog);
          return await action(backupModel);
        } catch (backupError: any) {
          this.logAttempt({
            id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            originalModel: model,
            attemptedModel: backupModel,
            error: backupError.message || String(backupError),
            timestamp: Date.now(),
            sessionId,
          });
        }
      }

      throw new Error(`No policy-compliant fallback is available for "${model}".`);
    }
  }
}

export const fallbackManager = new FallbackManager();
