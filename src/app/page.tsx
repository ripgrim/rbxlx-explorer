/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  parseRBXLX,
  exportToRBXLX,
  updatePropertyInRaw,
  updateScriptInRaw,
  updateNodeInTree,
  getNodePath,
} from "@/lib/parser";
import { TreeNode, ParsedRBXLX } from "@/types/rbxlx";
import { parseMapJson, looksLikeMapJson } from "@/lib/parseMapJson";
import FileUploader from "@/components/ui/FileUploader";
import TreeView from "@/components/ui/TreeView";
import PropertyEditor from "@/components/ui/PropertyEditor";
import ScriptEditor from "@/components/ui/ScriptEditor";
import Viewer3D from "@/components/ui/Viewer3D";
import NewProjectModal from "@/components/ui/NewProjectModal";
import { convertToMapJson } from "@/lib/convertMapJson";
import {
  Project,
  SpawnPoint,
  DEFAULT_SPAWN_SIZE,
  SourceFormat,
  loadProjectMeta,
  saveProjectMeta,
  loadProjectXml,
  saveProjectXml,
  loadQuickXml,
  saveQuickXml,
  loadSpawns,
  saveSpawns,
  loadSourceFormat,
  saveSourceFormat,
  loadDirHandle,
  saveDirHandle,
  deleteDirHandle,
  ensureWritePermission,
  writeToDirectory,
  downloadFile,
  newProjectId,
} from "@/lib/projects";
import {
  Save,
  Code,
  List,
  Settings,
  Check,
  AlertTriangle,
  Box,
  Trash2,
  Download,
  FolderOpen,
  FolderPlus,
  LogOut,
} from "lucide-react";

function PaneTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-6 px-2.5 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
        active
          ? "bg-[#2f2f2f] text-white shadow-sm"
          : "text-gray-400 hover:text-gray-200"
      }`}
      title={`Toggle ${label} pane`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function Home() {
  const [parsedData, setParsedData] = useState<ParsedRBXLX | null>(null);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [scriptContent, setScriptContent] = useState<string>("");
  const [modified, setModified] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [hasStoredFile, setHasStoredFile] = useState<boolean>(false);
  const [project, setProject] = useState<Project | null>(null);
  const [dirHandle, setDirHandleState] = useState<FileSystemDirectoryHandle | null>(null);
  const [showNewProject, setShowNewProject] = useState<boolean>(false);
  const [spawns, setSpawns] = useState<SpawnPoint[]>([]);
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>("rbxlx");
  const [showExplorer, setShowExplorer] = useState<boolean>(true);
  const [showProperties, setShowProperties] = useState<boolean>(true);
  const [show3D, setShow3D] = useState<boolean>(false);

  // Wrap each user-placed spawn in a synthetic TreeNode so it appears in the
  // sidebar under Workspace alongside real Roblox parts. Properties have no
  // `path`, so PropertyEditor edits become no-ops — the gizmo is the editor.
  const spawnTreeNodes = useMemo<TreeNode[]>(() => {
    return spawns.map((s, i) => ({
      id: s.id,
      name: `Spawn ${i + 1}`,
      class: "SpawnLocation",
      properties: [
        { name: "Position", type: "Vector3", value: s.position.join(", ") },
        { name: "Rotation", type: "Vector3", value: s.rotation.join(", ") },
        { name: "Size", type: "Vector3", value: s.size.join(", ") },
        { name: "Transparency", type: "float", value: 1 },
        { name: "CanCollide", type: "bool", value: false },
      ],
    }));
  }, [spawns]);

  const decoratedTree = useMemo<TreeNode[]>(() => {
    if (!parsedData) return [];
    if (spawnTreeNodes.length === 0) return parsedData.tree;
    let injected = false;
    const decorated = parsedData.tree.map((node) => {
      if (node.class === "Workspace") {
        injected = true;
        return {
          ...node,
          children: [...(node.children ?? []), ...spawnTreeNodes],
        };
      }
      return node;
    });
    return injected ? decorated : [...parsedData.tree, ...spawnTreeNodes];
  }, [parsedData, spawnTreeNodes]);

  const findNodeById = (nodes: TreeNode[], id: string): TreeNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = findNodeById(n.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const handleSelectPartFromViewer = (id: string) => {
    const node = findNodeById(decoratedTree, id);
    if (node) handleNodeSelect(node);
  };

  // Restore project or quick-mode source on mount.
  useEffect(() => {
    const savedFormat = loadSourceFormat();
    const meta = loadProjectMeta();
    if (meta) {
      const text = loadProjectXml();
      if (text) {
        try {
          const parser = savedFormat === "json" ? parseMapJson : parseRBXLX;
          const parsed = parser(text);
          setParsedData(parsed);
          setSourceFormat(savedFormat);
          setProject(meta);
          setHasStoredFile(true);
          setStatusMessage({
            type: "info",
            text: `Restored project "${meta.name}"`,
          });
          loadDirHandle(meta.id).then((h) => {
            if (h) setDirHandleState(h);
          });
          setSpawns(loadSpawns());
          return;
        } catch (e) {
          console.warn("Failed to restore project source:", e);
        }
      }
    }
    setSpawns(loadSpawns());

    const quick = loadQuickXml();
    if (quick) {
      try {
        const parser = savedFormat === "json" ? parseMapJson : parseRBXLX;
        const parsed = parser(quick);
        setParsedData(parsed);
        setSourceFormat(savedFormat);
        setHasStoredFile(true);
        setStatusMessage({ type: "info", text: "Restored last session from local storage" });
      } catch (e) {
        console.warn("Failed to restore quick source:", e);
        saveQuickXml(null);
      }
    }
  }, []);

  // Auto-save whenever parsedData changes. For rbxlx sources we re-serialize
  // the raw tree to XML; for JSON sources we re-serialize the tree to map JSON.
  useEffect(() => {
    if (!parsedData) return;
    try {
      let text: string;
      if (sourceFormat === "json") {
        const parts = convertToMapJson(parsedData.tree);
        text = JSON.stringify(parts, null, 4);
      } else {
        text = exportToRBXLX({ roblox: parsedData.raw.roblox });
      }
      if (project) saveProjectXml(text);
      else saveQuickXml(text);
      saveSourceFormat(sourceFormat);
      setHasStoredFile(true);
    } catch (e) {
      console.warn("Auto-save failed:", e);
    }
  }, [parsedData, project, sourceFormat]);

  useEffect(() => {
    saveSpawns(spawns);
  }, [spawns]);

  const handleAddSpawn = (pos: [number, number, number]) => {
    const id = Math.random().toString(36).slice(2, 9);
    setSpawns((prev) => [
      ...prev,
      { id, position: pos, rotation: [0, 0, 0], size: DEFAULT_SPAWN_SIZE },
    ]);
    setStatusMessage({
      type: "success",
      text: `Spawn placed at (${pos.map((n) => n.toFixed(1)).join(", ")})`,
    });
  };

  const handleClearSpawns = () => {
    setSpawns([]);
  };

  const handleUpdateSpawn = (
    id: string,
    update: { position?: [number, number, number]; rotation?: [number, number, number] }
  ) => {
    setSpawns((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              position: update.position ?? s.position,
              rotation: update.rotation ?? s.rotation,
            }
          : s
      )
    );
  };

  const handleRemoveSpawn = (id: string) => {
    setSpawns((prev) => prev.filter((s) => s.id !== id));
  };

  const handleClearStored = () => {
    if (project) {
      saveProjectXml(null);
      saveProjectMeta(null);
      deleteDirHandle(project.id);
      setProject(null);
      setDirHandleState(null);
    } else {
      saveQuickXml(null);
    }
    setParsedData(null);
    setSelectedNode(null);
    setScriptContent("");
    setModified(false);
    setHasStoredFile(false);
    setSpawns([]);
    setStatusMessage({ type: "info", text: "Cleared saved file" });
  };

  const handleCloseProject = () => {
    saveProjectMeta(null);
    saveProjectXml(null);
    if (project) deleteDirHandle(project.id);
    setProject(null);
    setDirHandleState(null);
    setParsedData(null);
    setSelectedNode(null);
    setScriptContent("");
    setModified(false);
    setHasStoredFile(false);
    setSpawns([]);
  };

  const handleCreateProject = async (data: {
    name: string;
    dirHandle: FileSystemDirectoryHandle | null;
    saveFolderName: string | null;
    fileContents: string;
    fileName: string;
  }) => {
    try {
      const { parsed, format } = parseSource(data.fileContents);
      const newProject: Project = {
        id: newProjectId(),
        name: data.name,
        saveFolderName: data.saveFolderName,
        createdAt: Date.now(),
      };
      // Clear any quick-mode autosave so we don't restore the wrong file later.
      saveQuickXml(null);
      saveProjectMeta(newProject);
      saveProjectXml(data.fileContents);
      saveSourceFormat(format);
      if (data.dirHandle) await saveDirHandle(newProject.id, data.dirHandle);
      setProject(newProject);
      setDirHandleState(data.dirHandle);
      setSourceFormat(format);
      setParsedData(parsed);
      setSelectedNode(null);
      setScriptContent("");
      setModified(false);
      setHasStoredFile(true);
      setSpawns([]);
      setShowNewProject(false);
      setStatusMessage({
        type: "success",
        text: `Created project "${newProject.name}"`,
      });
    } catch (e) {
      console.error("Project creation failed:", e);
      setStatusMessage({ type: "error", text: "Could not parse the RBXLX file" });
    }
  };

  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => {
        setStatusMessage(null);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  // Detect and parse either an rbxlx XML document or a map.json array.
  const parseSource = (
    content: string
  ): { parsed: ParsedRBXLX; format: SourceFormat } => {
    if (looksLikeMapJson(content)) {
      return { parsed: parseMapJson(content), format: "json" };
    }
    return { parsed: parseRBXLX(content), format: "rbxlx" };
  };

  const handleFileUploaded = (content: string) => {
    try {
      const { parsed, format } = parseSource(content);
      setParsedData(parsed);
      setSourceFormat(format);
      saveSourceFormat(format);
      setSelectedNode(null);
      setScriptContent("");
      setModified(false);

      setStatusMessage({
        type: "success",
        text: format === "json" ? "Loaded map JSON" : "File loaded successfully",
      });
    } catch (error) {
      console.error("Error parsing source file:", error);
      setStatusMessage({
        type: "error",
        text: "Could not parse the file. Expected a .rbxlx or map .json.",
      });
    }
  };

  const handleNodeSelect = (node: TreeNode) => {
    setSelectedNode(node);
    if (node.isScript && node.content) {
      setScriptContent(node.content);
    } else {
      setScriptContent("");
    }
  };

  const handlePropertyChange = (name: string, value: any) => {
    if (!selectedNode || !parsedData) return;

    try {
      const property = selectedNode.properties?.find((p) => p.name === name);
      if (!property || !property.path) return;

      const nodePath = getNodePath(parsedData.tree, selectedNode.id);

      const updatedRaw = updatePropertyInRaw(
        parsedData.raw,
        nodePath,
        property.path,
        value
      );

      const updatedTree = updateNodeInTree(
        parsedData.tree,
        nodePath,
        (node) => {
          const updatedNode = { ...node };

          if (updatedNode.properties) {
            const propIndex = updatedNode.properties.findIndex(
              (p) => p.name === name
            );
            if (propIndex !== -1) {
              updatedNode.properties[propIndex] = {
                ...updatedNode.properties[propIndex],
                value,
              };
            }
          }

          return updatedNode;
        }
      );

      setParsedData({
        raw: updatedRaw,
        tree: updatedTree,
      });

      const updatedSelectedNode = {
        ...selectedNode,
        properties: selectedNode.properties?.map((p) =>
          p.name === name ? { ...p, value } : p
        ),
      };

      setSelectedNode(updatedSelectedNode);
      setModified(true);
    } catch (error) {
      console.error("Error updating property:", error);

      setStatusMessage({
        type: "error",
        text: "Error updating property",
      });
    }
  };

  const handleScriptChange = (value: string | undefined) => {
    if (value === undefined || !selectedNode || !parsedData) return;

    try {
      setScriptContent(value);

      const nodePath = getNodePath(parsedData.tree, selectedNode.id);

      const updatedRaw = updateScriptInRaw(parsedData.raw, nodePath, value);

      const updatedTree = updateNodeInTree(
        parsedData.tree,
        nodePath,
        (node) => ({
          ...node,
          content: value,
        })
      );

      setParsedData({
        raw: updatedRaw,
        tree: updatedTree,
      });

      setSelectedNode({
        ...selectedNode,
        content: value,
      });

      setModified(true);
    } catch (error) {
      console.error("Error updating script content:", error);

      setStatusMessage({
        type: "error",
        text: "Error updating script content",
      });
    }
  };

  const projectBaseFilename = () => {
    const slug = (project?.name ?? "map")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "map";
  };

  const writeOrDownload = async (filename: string, contents: string, mime: string) => {
    if (project && dirHandle) {
      const ok = await ensureWritePermission(dirHandle);
      if (!ok) {
        downloadFile(filename, contents, mime);
        return { location: "Downloads (permission denied)" };
      }
      await writeToDirectory(dirHandle, filename, contents);
      return { location: `${project.saveFolderName ?? "project folder"}/` };
    }
    downloadFile(filename, contents, mime);
    return { location: "Downloads" };
  };

  const handleExportMapJson = async () => {
    if (!parsedData) return;
    try {
      const parts = convertToMapJson(parsedData.tree);
      // Inject any user-placed spawns at the front so the game's "first spawn"
      // lookup picks one of these instead of whatever lived in the rbxlx.
      const spawnEntries = spawns.map((s) => ({
        Type: "SpawnLocation",
        Position: s.position,
        Rotation: s.rotation,
        Size: s.size,
        Color: "a3a2a5",
        Transparency: 1,
        Shape: "Block",
        CantCollide: true,
      }));
      const all = [...spawnEntries, ...parts];
      const json = JSON.stringify(all, null, 4);
      const filename = `${projectBaseFilename()}.json`;
      const { location } = await writeOrDownload(filename, json, "application/json");
      const extra =
        spawnEntries.length > 0 ? ` (+ ${spawnEntries.length} spawn)` : "";
      setStatusMessage({
        type: "success",
        text: `Exported ${parts.length} parts${extra} → ${location}${filename}`,
      });
    } catch (error) {
      console.error("Error converting to map JSON:", error);
      setStatusMessage({ type: "error", text: "Error converting to map JSON" });
    }
  };

  const handleExport = async () => {
    if (!parsedData) return;
    try {
      const xmlContent = exportToRBXLX({ roblox: parsedData.raw.roblox });
      const filename = `${projectBaseFilename()}.rbxlx`;
      const { location } = await writeOrDownload(filename, xmlContent, "application/xml");
      setModified(false);
      setStatusMessage({
        type: "success",
        text: `Exported → ${location}${filename}`,
      });
    } catch (error) {
      console.error("Error exporting RBXLX file:", error);
      setStatusMessage({ type: "error", text: "Error exporting the file" });
    }
  };

  return (
    <main className="flex flex-col h-screen bg-[#0f0f0f] text-white">
      <header className="bg-[#161616] border-b border-[#2a2a2a] px-3 h-12 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {project ? (
            <div className="h-8 flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md pl-2.5 pr-1 min-w-0">
              <FolderOpen className="h-4 w-4 text-blue-400 flex-shrink-0" />
              <span className="text-sm font-medium truncate">{project.name}</span>
              <span className="text-xs text-gray-500 hidden sm:inline">
                · saves to{" "}
                <span className="text-gray-300">
                  {project.saveFolderName ? `${project.saveFolderName}/` : "Downloads"}
                </span>
              </span>
              <button
                onClick={handleCloseProject}
                className="h-6 w-6 ml-1 inline-flex items-center justify-center rounded text-gray-400 hover:text-red-300 hover:bg-red-950/40"
                title="Close project"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : parsedData ? (
            <div className="h-8 flex items-center gap-1.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-2.5 text-xs text-gray-400">
              <Download className="h-3.5 w-3.5" />
              Quick open · Downloads
            </div>
          ) : null}

          {parsedData && (
            <div className="h-8 flex items-center bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-1 gap-0.5">
              <PaneTab
                active={showExplorer}
                onClick={() => setShowExplorer((v) => !v)}
                icon={<List className="h-3.5 w-3.5" />}
                label="Explorer"
              />
              <PaneTab
                active={showProperties}
                onClick={() => setShowProperties((v) => !v)}
                icon={<Settings className="h-3.5 w-3.5" />}
                label="Properties"
              />
              <PaneTab
                active={show3D}
                onClick={() => setShow3D((v) => !v)}
                icon={<Box className="h-3.5 w-3.5" />}
                label="3D"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 min-w-0">
          {statusMessage && (
            <div
              className={`h-8 hidden md:inline-flex items-center gap-1.5 px-2.5 rounded-md text-xs max-w-xs truncate ${
                statusMessage.type === "success"
                  ? "bg-emerald-950/60 text-emerald-200 border border-emerald-800/60"
                  : statusMessage.type === "error"
                  ? "bg-red-950/60 text-red-200 border border-red-800/60"
                  : "bg-blue-950/60 text-blue-200 border border-blue-800/60"
              }`}
            >
              {statusMessage.type === "success" ? (
                <Check className="h-3.5 w-3.5 flex-shrink-0" />
              ) : statusMessage.type === "error" ? (
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              ) : null}
              <span className="truncate">{statusMessage.text}</span>
            </div>
          )}

          {modified && (
            <div className="h-8 inline-flex items-center px-2.5 rounded-md text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40">
              Unsaved
            </div>
          )}

          {hasStoredFile && (
            <button
              onClick={handleClearStored}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md text-xs text-gray-400 hover:text-red-300 hover:bg-red-950/40"
              title="Clear locally saved file"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}

          <button
            onClick={handleExportMapJson}
            disabled={!parsedData}
            className={`h-8 inline-flex items-center gap-1.5 px-3 rounded-md text-sm font-medium ${
              parsedData
                ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                : "bg-[#1f1f1f] text-gray-600 cursor-not-allowed"
            }`}
            title="Convert and download as game map JSON"
          >
            <Download className="h-4 w-4" />
            Map JSON
          </button>

          {sourceFormat === "rbxlx" && (
            <button
              onClick={handleExport}
              disabled={!parsedData}
              className={`h-8 inline-flex items-center gap-1.5 px-3 rounded-md text-sm font-medium ${
                parsedData
                  ? "bg-blue-600 hover:bg-blue-500 text-white"
                  : "bg-[#1f1f1f] text-gray-600 cursor-not-allowed"
              }`}
              title="Save modified rbxlx file"
            >
              <Save className="h-4 w-4" />
              Export
            </button>
          )}
        </div>
      </header>

      {!parsedData ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-semibold mb-2">RBXLX Explorer</h2>
              <p className="text-gray-400">
                Start a project, or just drop a file to preview and export.
              </p>
            </div>

            <button
              onClick={() => setShowNewProject(true)}
              className="w-full mb-5 flex items-center justify-center gap-2 px-4 py-3 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              <FolderPlus className="h-5 w-5" />
              New project
            </button>

            <div className="flex items-center gap-3 my-4 text-xs uppercase tracking-wider text-gray-500">
              <div className="flex-1 h-px bg-[#2a2a2a]" />
              or
              <div className="flex-1 h-px bg-[#2a2a2a]" />
            </div>

            <FileUploader onFileUploaded={handleFileUploaded} />
            <p className="mt-3 text-xs text-gray-500 text-center flex items-center justify-center gap-1.5">
              <Download className="h-3 w-3" />
              Quick-open files export to your Downloads folder
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          {!showExplorer && !showProperties && !show3D ? (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">
              All panes hidden — toggle one from the header to begin.
            </div>
          ) : (
          <PanelGroup direction="horizontal" autoSaveId="rbxlx-panes">
            {showExplorer && (
              <>
                <Panel defaultSize={20} minSize={15} order={1}>
                  <div className="h-full flex flex-col bg-[#121212] border-r border-[#2a2a2a]">
                    <div className="panel-header flex items-center">
                      <List className="h-4 w-4 mr-2 text-blue-500" />
                      <span>Explorer</span>
                    </div>
                    <div className="flex-1 overflow-auto py-1">
                      <TreeView
                        nodes={decoratedTree}
                        onSelectNode={handleNodeSelect}
                        selectedNodeId={selectedNode?.id || null}
                      />
                    </div>
                  </div>
                </Panel>
                {(showProperties || show3D) && (
                  <PanelResizeHandle className="resize-handle" />
                )}
              </>
            )}

            {showProperties && (
              <Panel order={2}>
              {selectedNode ? (
                <div className="h-full flex flex-col">
                  <div className="panel-header flex items-center justify-between">
                    <div className="flex items-center">
                      <Settings className="h-4 w-4 mr-2 text-blue-500" />
                      <span>{selectedNode.name}</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 bg-[#252525] rounded text-gray-400">
                      {selectedNode.class}
                    </span>
                  </div>

                  {selectedNode.isScript ? (
                    <div className="flex-1 overflow-hidden">
                      <PanelGroup direction="vertical">
                        <Panel defaultSize={30} minSize={10}>
                          <div className="h-full overflow-auto">
                            <PropertyEditor
                              properties={selectedNode.properties || []}
                              onPropertyChange={handlePropertyChange}
                            />
                          </div>
                        </Panel>

                        <PanelResizeHandle className="h-1 bg-[#1a1a1a]" />

                        <Panel defaultSize={70}>
                          <div className="h-full flex flex-col">
                            <div className="panel-header flex items-center">
                              <Code className="h-4 w-4 mr-2 text-yellow-500" />
                              <span>Script</span>
                            </div>
                            <div className="flex-1 overflow-hidden">
                              <ScriptEditor
                                content={scriptContent}
                                onChange={handleScriptChange}
                              />
                            </div>
                          </div>
                        </Panel>
                      </PanelGroup>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-auto">
                      <PropertyEditor
                        properties={selectedNode.properties || []}
                        onPropertyChange={handlePropertyChange}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  Select an item to view its properties
                </div>
              )}
              </Panel>
            )}

            {show3D && (
              <>
                {showProperties && <PanelResizeHandle className="resize-handle" />}
                <Panel defaultSize={35} minSize={20} order={3}>
                  <Viewer3D
                    tree={parsedData.tree}
                    selectedNodeId={selectedNode?.id || null}
                    onSelectPart={handleSelectPartFromViewer}
                    spawns={spawns}
                    onAddSpawn={handleAddSpawn}
                    onClearSpawns={handleClearSpawns}
                    onUpdateSpawn={handleUpdateSpawn}
                    onRemoveSpawn={handleRemoveSpawn}
                  />
                </Panel>
              </>
            )}
          </PanelGroup>
          )}
        </div>
      )}

      {showNewProject && (
        <NewProjectModal
          onCancel={() => setShowNewProject(false)}
          onCreate={handleCreateProject}
        />
      )}
    </main>
  );
}
