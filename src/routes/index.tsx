import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Circle, Pencil, Plus, Trash2, X } from "lucide-react";

export const Route = createFileRoute("/")({
  component: TodoApp,
  head: () => ({
    meta: [
      { title: "Daylist — A focused to-do list" },
      { name: "description", content: "A calm, local-first to-do list for getting things done." },
    ],
  }),
});

type Filter = "all" | "active" | "completed";
type Todo = { id: string; text: string; completed: boolean; createdAt: number };

const STORAGE_KEY = "daylist.todos.v1";

const starterTodos: Todo[] = [
  { id: "welcome-1", text: "Make today count", completed: false, createdAt: Date.now() - 2 },
  { id: "welcome-2", text: "Take a proper break", completed: false, createdAt: Date.now() - 1 },
  { id: "welcome-3", text: "Wrap up one small thing", completed: true, createdAt: Date.now() },
];

function readTodos(): Todo[] {
  if (typeof window === "undefined") return starterTodos;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return starterTodos;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return starterTodos;
    return parsed.filter(
      (todo): todo is Todo =>
        Boolean(todo) &&
        typeof todo === "object" &&
        typeof (todo as Todo).id === "string" &&
        typeof (todo as Todo).text === "string" &&
        typeof (todo as Todo).completed === "boolean",
    );
  } catch {
    return starterTodos;
  }
}

function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>(readTodos);
  const [newTodo, setNewTodo] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  }, [todos]);

  const remaining = todos.filter((todo) => !todo.completed).length;
  const completed = todos.length - remaining;
  const visibleTodos = useMemo(
    () => todos.filter((todo) => filter === "all" || (filter === "active" ? !todo.completed : todo.completed)),
    [filter, todos],
  );

  function addTodo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = newTodo.trim();
    if (!text) return;
    setTodos((current) => [
      { id: crypto.randomUUID(), text, completed: false, createdAt: Date.now() },
      ...current,
    ]);
    setNewTodo("");
  }

  function toggleTodo(id: string) {
    setTodos((current) => current.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)));
  }

  function removeTodo(id: string) {
    setTodos((current) => current.filter((todo) => todo.id !== id));
  }

  function startEditing(todo: Todo) {
    setEditingId(todo.id);
    setEditingText(todo.text);
  }

  function saveEdit(id: string) {
    const text = editingText.trim();
    if (text) setTodos((current) => current.map((todo) => (todo.id === id ? { ...todo, text } : todo)));
    setEditingId(null);
  }

  return (
    <main className="min-h-screen bg-[#f8f7f4] px-5 py-10 text-[#292725] sm:px-8 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 flex items-end justify-between gap-6">
          <div>
            <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[#d75d3d]">Personal workspace</p>
            <h1 className="text-4xl font-semibold tracking-[-0.05em] text-[#292725] sm:text-6xl">Daylist<span className="text-[#d75d3d]">.</span></h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-[#77716b]">A little space for the things worth doing today.</p>
          </div>
          <div className="hidden rounded-2xl border border-[#e8e3dc] bg-white px-4 py-3 text-right shadow-sm sm:block">
            <div className="font-mono text-2xl font-semibold text-[#d75d3d]">{remaining}</div>
            <div className="text-xs text-[#918b84]">left to do</div>
          </div>
        </header>

        <section className="rounded-[1.75rem] border border-[#e8e3dc] bg-white p-4 shadow-[0_20px_60px_-35px_rgba(74,61,48,0.35)] sm:p-7">
          <form onSubmit={addTodo} className="flex gap-3">
            <label htmlFor="new-todo" className="sr-only">Add a task</label>
            <input
              id="new-todo"
              value={newTodo}
              onChange={(event) => setNewTodo(event.target.value)}
              placeholder="What needs your attention?"
              className="min-w-0 flex-1 rounded-xl border border-[#e8e3dc] bg-[#fbfaf8] px-4 py-3 text-sm outline-none transition placeholder:text-[#aaa39a] focus:border-[#d75d3d] focus:ring-4 focus:ring-[#d75d3d]/10"
            />
            <button type="submit" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#d75d3d] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#c95235] focus:outline-none focus:ring-4 focus:ring-[#d75d3d]/25">
              <Plus size={17} strokeWidth={2.5} /> <span className="hidden sm:inline">Add task</span>
            </button>
          </form>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-[#eeeae5] pb-4">
            <div className="flex gap-1 rounded-lg bg-[#f7f4f0] p-1" role="tablist" aria-label="Filter tasks">
              {(["all", "active", "completed"] as Filter[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  role="tab"
                  aria-selected={filter === option}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${filter === option ? "bg-white text-[#292725] shadow-sm" : "text-[#918b84] hover:text-[#292725]"}`}
                >
                  {option}
                </button>
              ))}
            </div>
            <span className="font-mono text-xs text-[#aaa39a]">{todos.length} {todos.length === 1 ? "task" : "tasks"}</span>
          </div>

          <div className="divide-y divide-[#eeeae5]">
            {visibleTodos.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-16 text-center">
                <div className="mb-4 rounded-full bg-[#f8ede8] p-3 text-[#d75d3d]"><Check size={22} /></div>
                <p className="font-medium">{filter === "completed" ? "Nothing completed yet" : "You’re all clear"}</p>
                <p className="mt-1 text-sm text-[#918b84]">Add a task above and make some progress.</p>
              </div>
            ) : (
              visibleTodos.map((todo) => (
                <div key={todo.id} className="group flex items-center gap-3 py-4 first:pt-5 last:pb-2">
                  <button type="button" onClick={() => toggleTodo(todo.id)} aria-label={todo.completed ? `Mark ${todo.text} active` : `Complete ${todo.text}`} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${todo.completed ? "border-[#d75d3d] bg-[#d75d3d] text-white" : "border-[#d5cec5] text-transparent hover:border-[#d75d3d]"}`}>
                    {todo.completed ? <Check size={14} strokeWidth={3} /> : <Circle size={11} />}
                  </button>
                  {editingId === todo.id ? (
                    <input autoFocus value={editingText} onChange={(event) => setEditingText(event.target.value)} onBlur={() => saveEdit(todo.id)} onKeyDown={(event) => { if (event.key === "Enter") saveEdit(todo.id); if (event.key === "Escape") setEditingId(null); }} className="min-w-0 flex-1 border-b border-[#d75d3d] bg-transparent py-1 text-sm outline-none" />
                  ) : (
                    <span className={`min-w-0 flex-1 text-sm transition ${todo.completed ? "text-[#aaa39a] line-through" : "text-[#494541]"}`}>{todo.text}</span>
                  )}
                  <div className="flex shrink-0 items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                    <button type="button" onClick={() => startEditing(todo)} aria-label={`Edit ${todo.text}`} className="rounded-lg p-2 text-[#aaa39a] hover:bg-[#f7f4f0] hover:text-[#292725]"><Pencil size={15} /></button>
                    <button type="button" onClick={() => removeTodo(todo.id)} aria-label={`Delete ${todo.text}`} className="rounded-lg p-2 text-[#aaa39a] hover:bg-[#fbecea] hover:text-[#c95235]"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))
            )}
          </div>

          <footer className="mt-5 flex items-center justify-between border-t border-[#eeeae5] pt-4 text-xs text-[#aaa39a]">
            <span>{completed > 0 ? `${completed} completed` : "Keep going"}</span>
            {completed > 0 && <button type="button" onClick={() => setTodos((current) => current.filter((todo) => !todo.completed))} className="inline-flex items-center gap-1.5 text-[#918b84] transition hover:text-[#c95235]"><X size={14} /> Clear completed</button>}
          </footer>
        </section>
        <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-[#aaa39a]">Saved locally in your browser</p>
      </div>
    </main>
  );
}
