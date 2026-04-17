const LOGO = ` ███████╗ ██████╗ ██╗     ███████╗██╗  ██╗██╗███████╗██╗     ██████╗
 ██╔════╝██╔═══██╗██║     ██╔════╝██║  ██║██║██╔════╝██║     ██╔══██╗
 ███████╗██║   ██║██║     ███████╗███████║██║█████╗  ██║     ██║  ██║
 ╚════██║██║   ██║██║     ╚════██║██╔══██║██║██╔══╝  ██║     ██║  ██║
 ███████║╚██████╔╝███████╗███████║██║  ██║██║███████╗███████╗██████╔╝
 ╚══════╝ ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚═════╝`;

export function AsciiLogo() {
  return (
    <div className="overflow-x-auto max-w-full">
      <pre
        className="glitch text-neon-green whitespace-pre font-mono leading-[1] select-none cursor-default text-[6px] xs:text-[7px] sm:text-[9px] md:text-[11px] lg:text-[13px]"
        data-text={LOGO}
      >
        {LOGO}
      </pre>
    </div>
  );
}
