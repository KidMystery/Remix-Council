import { useState, useRef } from 'react';
import { extractCodeFromArchive, ZipArchiveResult } from '../lib/zipReader';
import { extractTextFromPDF } from '../lib/pdfUtils';

export interface AttachedFile {
  name: string;
  content: string;
  size: number;
  type: string;
  unzippedResult?: ZipArchiveResult;
}

interface UseFileAttachmentOptions {
  showToast: (msg: string) => void;
}

export function useFileAttachment({ showToast }: UseFileAttachmentOptions) {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [activeZipResult, setActiveZipResult] = useState<ZipArchiveResult | null>(null);
  const [isZipModalOpen, setIsZipModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const processFiles = async (files: FileList | File[] | DataTransferItemList) => {
    if (!files || files.length === 0) return;
    setFileError(null);

    const fileList: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item instanceof DataTransferItem) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) fileList.push(file);
        }
      } else {
        fileList.push(item);
      }
    }

    const allowedExtensions = [
      '.txt', '.md', '.csv', '.json', '.js', '.ts', '.jsx', '.tsx',
      '.html', '.css', '.pdf', '.png', '.jpg', '.jpeg', '.webp',
      '.gif', '.heic', '.svg', '.zip', '.rar', '.tar', '.gz', '.tgz', '.7z'
    ];
    const allowedMimeTypes = [
      'text/', 'application/json', 'application/pdf', 'image/',
      'application/zip', 'application/x-zip-compressed', 'application/zip-compressed',
      'application/x-rar', 'application/vnd.rar', 'application/x-rar-compressed', 'application/rar',
    ];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const lowerName = file.name.toLowerCase();
      const isImage = file.type.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif|svg|heic)$/i.test(file.name);
      const isArchive =
        lowerName.endsWith('.zip') ||
        lowerName.endsWith('.rar') ||
        lowerName.endsWith('.tar') ||
        lowerName.endsWith('.gz') ||
        lowerName.endsWith('.tgz') ||
        lowerName.endsWith('.7z') ||
        file.type.includes('zip') ||
        file.type.includes('rar');

      const isAllowed =
        isImage ||
        isArchive ||
        allowedMimeTypes.some((m) => file.type.startsWith(m)) ||
        allowedExtensions.some((ext) => lowerName.endsWith(ext));

      if (!isAllowed) {
        setFileError(`Unsupported file format: ${file.name}. Only code, text, PDF, ZIP/RAR archives, and images are supported.`);
        continue;
      }

      if (file.size > 30 * 1024 * 1024) {
        setFileError(`File too large: ${file.name}. Maximum size is 30MB.`);
        continue;
      }

      if (isArchive) {
        try {
          const archiveResult = await extractCodeFromArchive(file);
          if (archiveResult.extractedCodeFilesCount === 0) {
            setFileError(`Archive ${file.name} contained no readable code or text files.`);
            continue;
          }
          const isRar = lowerName.endsWith('.rar') || file.type.includes('rar');
          setAttachedFiles((prev) => [
            ...prev,
            {
              name: file.name,
              content: archiveResult.formattedContext,
              size: file.size,
              type: isRar ? 'application/x-rar' : 'application/zip',
              unzippedResult: archiveResult,
            },
          ]);
          const label = isRar ? 'RAR' : 'ZIP';
          if (archiveResult.wasTruncated) {
            showToast(`📦 Extracted ${archiveResult.extractedCodeFilesCount} files from ${file.name} (capped by guardrails)`);
          } else {
            showToast(`📦 Extracted ${archiveResult.extractedCodeFilesCount} code files from ${file.name} (${label})`);
          }
        } catch (error: any) {
          console.error('Error reading archive:', error);
          setFileError(`Could not read code from archive: ${file.name}. ${error?.message || ''}`);
        }
      } else if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
        try {
          let text = await extractTextFromPDF(file);
          if (text.length > 150_000) {
            text = text.slice(0, 150_000) + '\n\n... [PDF TRUNCATED AFTER 150,000 CHARS]';
            showToast(`⚠️ PDF ${file.name} truncated to 150,000 characters.`);
          }
          setAttachedFiles((prev) => [
            ...prev,
            { name: file.name, content: text, size: file.size, type: 'application/pdf' },
          ]);
        } catch (error) {
          console.error('Error reading PDF:', error);
          setFileError(`Could not read text from PDF: ${file.name}`);
        }
      } else if (isImage) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target && typeof event.target.result === 'string') {
            setAttachedFiles((prev) => [
              ...prev,
              { name: file.name, content: event.target!.result as string, size: file.size, type: file.type || 'image/jpeg' },
            ]);
          }
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = event.target?.result;
          if (typeof result === 'string') {
            let text = result;
            if (text.length > 150_000) {
              text = text.slice(0, 150_000) + '\n\n... [FILE TRUNCATED AFTER 150,000 CHARS]';
              showToast(`⚠️ File ${file.name} truncated to 150,000 characters.`);
            }
            setAttachedFiles((prev) => [
              ...prev,
              { name: file.name, content: text, size: file.size, type: file.type || 'text/plain' },
            ]);
          }
        };
        reader.readAsText(file);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processFiles(e.target.files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData && e.clipboardData.items) {
      const items = e.clipboardData.items;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        await processFiles(files);
      }
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer && e.dataTransfer.items) {
      await processFiles(e.dataTransfer.items);
    } else if (e.dataTransfer && e.dataTransfer.files) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAttachedFiles = () => {
    setAttachedFiles([]);
  };

  return {
    attachedFiles,
    setAttachedFiles,
    fileError,
    setFileError,
    activeZipResult,
    setActiveZipResult,
    isZipModalOpen,
    setIsZipModalOpen,
    fileInputRef,
    processFiles,
    handleFileUpload,
    handlePaste,
    handleDrop,
    handleDragOver,
    removeAttachedFile,
    clearAttachedFiles,
  };
}
