import React, { useRef } from 'react';
import { KnowledgeFile } from '../types';
import { BookOpenIcon, TrashIcon, XIcon, UploadIcon } from './icons';

interface KnowledgeBaseModalProps {
    isOpen: boolean;
    onClose: () => void;
    files: KnowledgeFile[];
    onAddFiles: (newFiles: KnowledgeFile[]) => void;
    onRemoveFile: (fileName: string) => void;
}

const KnowledgeBaseModal: React.FC<KnowledgeBaseModalProps> = ({ isOpen, onClose, files, onAddFiles, onRemoveFile }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = event.target.files;
        if (!selectedFiles) return;

        const filePromises = Array.from(selectedFiles).map(file => {
            return new Promise<KnowledgeFile>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target?.result as string;
                    resolve({ name: file.name, content });
                };
                reader.onerror = (e) => reject(e);
                reader.readAsText(file);
            });
        });

        Promise.all(filePromises).then(newFiles => {
            onAddFiles(newFiles);
        }).catch(err => {
            console.error("Error reading files:", err);
            // Optionally, show an error message to the user
        });
        
        // Reset file input to allow re-uploading the same file
        if(event.target) {
            event.target.value = '';
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" aria-modal="true" role="dialog">
            <div className="bg-base-200 rounded-lg shadow-xl w-full max-w-2xl border border-base-300 transform transition-all">
                <div className="flex justify-between items-center p-4 border-b border-base-300">
                    <div className="flex items-center gap-3">
                        <BookOpenIcon className="w-6 h-6 text-brand-secondary" />
                        <h2 className="text-lg font-bold text-white">Knowledge Base</h2>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-base-300" aria-label="Close modal">
                        <XIcon className="w-6 h-6 text-content-200" />
                    </button>
                </div>
                
                <div className="p-6 max-h-[60vh] overflow-y-auto">
                    <p className="text-sm text-content-200 mb-4">
                        Upload markdown (.md) files containing rules, data definitions, or other context. This information will be sent to the AI with every analysis request to improve its accuracy. Files are saved in your browser's local storage.
                    </p>

                    {files.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-content-200">No knowledge files uploaded yet.</p>
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {files.map(file => (
                                <li key={file.name} className="flex items-center justify-between bg-base-300 p-3 rounded-md">
                                    <span className="text-content-100 font-medium truncate" title={file.name}>{file.name}</span>
                                    <button 
                                        onClick={() => onRemoveFile(file.name)}
                                        className="p-1 text-red-400 hover:text-red-300 rounded-full hover:bg-base-100"
                                        aria-label={`Remove ${file.name}`}
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="p-4 border-t border-base-300 flex justify-end gap-4">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".md, .markdown, .txt"
                        multiple
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-brand-secondary text-white font-bold py-2 px-4 rounded-lg hover:bg-brand-primary transition-colors flex items-center gap-2"
                    >
                        <UploadIcon className="w-5 h-5"/>
                        Add File(s)
                    </button>
                    <button 
                        onClick={onClose}
                        className="bg-base-300 text-content-100 font-bold py-2 px-4 rounded-lg hover:bg-base-100 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default KnowledgeBaseModal;
