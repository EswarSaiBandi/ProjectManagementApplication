import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gray-50">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex">
        <h1 className="text-4xl font-bold text-blue-900">project studio.</h1>
        <div className="fixed bottom-0 left-0 flex h-48 w-full items-end justify-center bg-gradient-to-t from-white via-white dark:from-black dark:via-black lg:static lg:h-auto lg:w-auto lg:bg-none">
          <Link href="/login">
            <Button className="font-semibold text-lg px-8 py-6">Login to Dashboard</Button>
          </Link>
        </div>
      </div>

      <div className="mt-12 grid text-center lg:max-w-5xl lg:w-full lg:mb-0 lg:grid-cols-3 lg:text-left gap-8">
        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100/30">
          <h2 className="mb-3 text-2xl font-semibold">Monitor Sites</h2>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            Real-time updates from your construction sites directly from the field.
          </p>
        </div>
        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100/30">
          <h2 className="mb-3 text-2xl font-semibold">Voice Reports</h2>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            AI-powered transcription for effortless daily reporting by supervisors.
          </p>
        </div>
        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100/30">
          <h2 className="mb-3 text-2xl font-semibold">Track Progress</h2>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            Visual timelines and activity tracking to keep projects on schedule.
          </p>
        </div>
      </div>
    </main>
  );
}
