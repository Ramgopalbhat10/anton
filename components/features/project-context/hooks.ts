"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  ProjectMemory,
  SkillDocument,
  SkillSummary,
} from "@/src/lib/api-types";
import {
  errorMessage,
  getJson,
  jsonHeaders,
  requestJson,
  requestOk,
} from "@/src/lib/client-fetch";

export function useMemories(active: boolean) {
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getJson<{ memories: ProjectMemory[] }>("/api/memories");
      setMemories(data.memories);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load memories"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetching on activation updates state after the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void loadMemories();
  }, [active, loadMemories]);

  const create = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return false;
      setSaving(true);
      try {
        await requestJson<{ memory: ProjectMemory }>("/api/memories", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ content: trimmed }),
        });
        await loadMemories();
        return true;
      } catch (err) {
        setError(errorMessage(err, "Create failed"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadMemories],
  );

  const update = useCallback(
    async (id: string, content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return false;
      setSaving(true);
      try {
        await requestJson<{ memory: ProjectMemory }>(
          `/api/memories/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: jsonHeaders(),
            body: JSON.stringify({ content: trimmed }),
          },
        );
        await loadMemories();
        return true;
      } catch (err) {
        setError(errorMessage(err, "Update failed"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadMemories],
  );

  const remove = useCallback(
    async (id: string) => {
      setSaving(true);
      try {
        await requestOk(`/api/memories/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        await loadMemories();
        return true;
      } catch (err) {
        setError(errorMessage(err, "Delete failed"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadMemories],
  );

  return {
    memories,
    loading,
    saving,
    error,
    create,
    update,
    remove,
  };
}

export function useSkills(active: boolean) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [skillLoading, setSkillLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const loadSkills = async () => {
      setLoading(true);
      try {
        const data = await getJson<{
          skills: SkillSummary[];
          warnings: string[];
        }>("/api/skills");
        setSkills(data.skills);
        setWarnings(data.warnings);
        setSelectedSlug((current) =>
          current && data.skills.some((skill) => skill.slug === current)
            ? current
            : data.skills[0]?.slug ?? null,
        );
        setError(null);
      } catch (err) {
        setError(errorMessage(err, "Failed to load skills"));
      } finally {
        setLoading(false);
      }
    };
    void loadSkills();
  }, [active]);

  useEffect(() => {
    if (!selectedSlug) return;
    const loadSkill = async () => {
      setSkillLoading(true);
      try {
        const data = await getJson<{ skill: SkillDocument }>(
          `/api/skills/${encodeURIComponent(selectedSlug)}`,
        );
        setSelectedSkill(data.skill);
        setError(null);
      } catch (err) {
        setSelectedSkill(null);
        setError(errorMessage(err, "Failed to load skill"));
      } finally {
        setSkillLoading(false);
      }
    };
    void loadSkill();
  }, [selectedSlug]);

  return {
    skills,
    warnings,
    selectedSlug,
    selectedSkill,
    loading,
    skillLoading,
    error,
    setSelectedSlug,
  };
}
