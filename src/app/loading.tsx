export default function Loading() {
  return (
    <div className="fixed top-0 left-0 right-0 z-overlay h-0.5 overflow-hidden">
      <div className="h-full w-1/3 animate-loading-bar rounded-full bg-accentBlue" />
    </div>
  );
}
