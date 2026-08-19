import React, { useState } from 'react';
import { X, Plus, Sparkles, UserPlus, Check, Trash2 } from 'lucide-react';
import { Persona } from '../types';
import { COLOR_THEMES } from '../lib/councilPresets';
import { LATEST_GEMINI_FLASH } from '../config/modelCatalog';

interface CreatePersonalityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (persona: Persona) => void;
  availableModels: { id: string; name: string }[];
  editingPersona?: Persona | null;
}

const EMOJI_OPTIONS = ['🛡️', '🔮', '⚡', '📈', '🧘', '⚖️', '🎯', '🚀', '💻', '🏛️', '💰', '🔬', '🧬', '🎨', '🧠', '👔', '📊', '🔒', '🌐', '🤖', '💼', '🌿', '💡', '🧩', '⚖️'];

export function CreatePersonalityModal({
  isOpen,
  onClose,
  onSave,
  availableModels,
  editingPersona,
}: CreatePersonalityModalProps) {
  const defaultModel = availableModels[0]?.id || LATEST_GEMINI_FLASH;
  const [name, setName] = useState(editingPersona?.name || '');
  const [role, setRole] = useState(editingPersona?.role || '');
  const [avatar, setAvatar] = useState(editingPersona?.avatar || '🧠');
  const [model, setModel] = useState(editingPersona?.model || defaultModel);
  const [color, setColor] = useState(editingPersona?.color || COLOR_THEMES[0].value);
  const [systemPrompt, setSystemPrompt] = useState(
    editingPersona?.systemPrompt ||
      'You are a specialized council member. Provide rigorous, clear, and actionable feedback based on your domain expertise.'
  );

  // Sync state if editingPersona changes
  React.useEffect(() => {
    if (editingPersona) {
      setName(editingPersona.name);
      setRole(editingPersona.role);
      setAvatar(editingPersona.avatar);
      setModel(editingPersona.model);
      setColor(editingPersona.color);
      setSystemPrompt(editingPersona.systemPrompt);
    } else {
      setName('');
      setRole('');
      setAvatar('🧠');
      setModel(availableModels[0]?.id || LATEST_GEMINI_FLASH);
      setColor(COLOR_THEMES[0].value);
      setSystemPrompt(
        'You are a specialized council member. Provide rigorous, clear, and actionable feedback based on your domain expertise.'
      );
    }
  }, [editingPersona, isOpen, availableModels]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim()) return;

    const id = editingPersona?.id || `persona-${Date.now()}`;
    const personaToSave: Persona = {
      id,
      name: name.trim(),
      role: role.trim(),
      avatar: avatar.trim() || '🧠',
      model: model.trim() || defaultModel,
      color,
      systemPrompt: systemPrompt.trim(),
      enabled: true,
    };

    onSave(personaToSave);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <UserPlus size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editingPersona ? 'Edit Council Personality' : 'Create New Council Personality'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Define a custom perspective, role directive, and assigned LLM model.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Avatar Icon & Name */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Avatar / Emoji
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={4}
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  className="w-14 text-center text-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-1.5 focus:outline-none focus:border-indigo-500"
                />
                <div className="flex flex-wrap gap-1 max-w-[120px] max-h-16 overflow-y-auto custom-scrollbar p-1 border border-slate-100 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950/50">
                  {EMOJI_OPTIONS.map((emoji, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setAvatar(emoji)}
                      className={`text-xs p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors ${
                        avatar === emoji ? 'bg-indigo-100 dark:bg-indigo-900/50' : ''
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Personality Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g., Tax Auditor, Life Coach, Crypto Analyst"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Role Title */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Role Title / Specialty <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g., Fiscal Liabilities & Regulatory Risk Specialist"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Assigned LLM Model */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Assigned LLM Model
            </label>
            <input
              list="modal-available-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Select or search model..."
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
            <datalist id="modal-available-models">
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
          </div>

          {/* Badge Color Theme */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Badge Color Theme
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {COLOR_THEMES.map((themeOption) => {
                const isSelected = color === themeOption.value;
                return (
                  <button
                    key={themeOption.label}
                    type="button"
                    onClick={() => setColor(themeOption.value)}
                    className={`p-2 border rounded-lg text-[10px] font-bold text-center flex items-center justify-between gap-1 transition-all ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${themeOption.bgClass}`} />
                    <span className="truncate">{themeOption.label.split(' ')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* System Prompt / Directive */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              System Directive & Prompt Instructions
            </label>
            <textarea
              rows={4}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Instruct this persona on what perspective to take, what risks to evaluate, and how to analyze user questions..."
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 resize-none"
            />
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
              This prompt guides how this persona responds during Stage 1 proposals and Stage 2 peer reviews.
            </p>
          </div>

          {/* Footer Submit */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>{editingPersona ? 'Save Changes' : 'Add Personality'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
