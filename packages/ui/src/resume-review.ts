import type { AppState, OfferAPI, ProfileInput } from '../../shared/src/contracts.js';
import { pickCareerInput } from '../../profile/src/career-input.js';

/** Confirm the one education the user selected; leave every other imported record pending. */
export async function confirmResumeForApplication(options: {
  state: AppState; draft: ProfileInput; dirty: boolean; expectedVersion: number; educationId: string;
  api: Pick<OfferAPI, 'saveProfile' | 'confirmCareerRecord'>;
  onSaved: (state: AppState) => void;
}): Promise<AppState> {
  const selected = options.draft.career?.educations.find(item => item.id === options.educationId);
  if (options.draft.career?.educations.length && !selected) throw new Error('请明确选择一条用于匹配和普通网申的教育，不会自动猜最高学历。');
  if (options.state.profile.version !== options.expectedVersion) throw new Error('资料版本已变化，草稿仍保留；请重新核对后保存。');
  let updated = options.state;
  if (options.dirty) { updated = await options.api.saveProfile(options.draft, options.expectedVersion); options.onSaved(updated); }
  if (selected) {
    const saved = updated.profile.career?.educations.find(item => item.id === selected.id);
    if (!saved) throw new Error('所选教育还未保存，请重新核对。');
    if (saved.confirmation !== 'confirmed' || saved.confirmedRevision !== saved.revision) {
      updated = await options.api.confirmCareerRecord('educations', saved.id, updated.profile.version, saved.revision);
      options.onSaved(updated);
    }
    if (updated.profile.career?.primaryEducationId !== saved.id) {
      const { version, updatedAt, ...profile } = updated.profile;
      updated = await options.api.saveProfile({ ...profile, career: { ...pickCareerInput(updated.profile.career), primaryEducationId: saved.id } }, updated.profile.version);
      options.onSaved(updated);
    }
  }
  return updated;
}
