import React, { useRef, useState } from "react";
import { FolderOpen, FileUp, X, Download, FolderPlus } from "lucide-react";
import { FSA_SUPPORTED, pickDirectory } from "@/lib/projects";

interface NewProjectModalProps {
  onCancel: () => void;
  onCreate: (data: {
    name: string;
    dirHandle: FileSystemDirectoryHandle | null;
    saveFolderName: string | null;
    fileContents: string;
    fileName: string;
  }) => void;
}

export default function NewProjectModal({ onCancel, onCreate }: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderLabel, setFolderLabel] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePickFolder = async () => {
    const handle = await pickDirectory();
    if (handle) {
      setDirHandle(handle);
      setFolderLabel(handle.name);
    }
  };

  const handleClearFolder = () => {
    setDirHandle(null);
    setFolderLabel(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !file.name.endsWith(".rbxlx") &&
      !file.name.endsWith(".xml") &&
      !file.name.endsWith(".json")
    ) {
      setError("Please pick a .rbxlx, .xml, or map .json file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        setFileContents(text);
        setFileName(file.name);
        setError(null);
      }
    };
    reader.readAsText(file);
  };

  const canCreate = name.trim().length > 0 && fileContents != null;

  const handleSubmit = () => {
    if (!canCreate || !fileContents || !fileName) return;
    onCreate({
      name: name.trim(),
      dirHandle,
      saveFolderName: folderLabel,
      fileContents,
      fileName,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg bg-[#161616] border border-[#2a2a2a] rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2a2a]">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-blue-400" />
            <h2 className="text-lg font-semibold">New project</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-[#252525] text-gray-400"
            aria-label="Cancel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Project name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NDS Remake"
              className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Save location
            </label>
            {!FSA_SUPPORTED ? (
              <div className="text-xs text-gray-400 px-3 py-2 bg-[#0f0f0f] border border-[#2a2a2a] rounded flex items-center gap-2">
                <Download className="h-4 w-4 text-gray-500" />
                Your browser doesn&apos;t support folder picking — exports will go
                to your <span className="text-gray-300 font-medium">Downloads</span>
                folder.
              </div>
            ) : folderLabel ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-[#0f0f0f] border border-emerald-700/60 rounded">
                <FolderOpen className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                <span className="text-sm text-emerald-200 truncate flex-1">
                  {folderLabel}/
                </span>
                <button
                  onClick={handleClearFolder}
                  className="text-xs text-gray-400 hover:text-red-300"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePickFolder}
                  className="px-3 py-2 text-sm bg-[#252525] hover:bg-[#303030] rounded flex items-center gap-2"
                >
                  <FolderOpen className="h-4 w-4" />
                  Choose folder…
                </button>
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Download className="h-3 w-3" />
                  Leave empty to save to <span className="font-medium">Downloads</span>
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Source file (.rbxlx or .json)
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2 text-sm bg-[#252525] hover:bg-[#303030] rounded flex items-center gap-2"
              >
                <FileUp className="h-4 w-4" />
                {fileName ? "Change file…" : "Choose file…"}
              </button>
              {fileName && (
                <span className="text-sm text-gray-300 truncate">{fileName}</span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".rbxlx,.xml,.json"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#2a2a2a] flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded bg-[#252525] hover:bg-[#303030]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canCreate}
            className={`px-4 py-1.5 text-sm rounded ${
              canCreate
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-gray-800 opacity-50 cursor-not-allowed"
            }`}
          >
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}
