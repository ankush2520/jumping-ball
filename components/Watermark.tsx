"use client";

import Image from "next/image";

const Watermark = () => {
  return (
    <Image
      src="/images/bounce-watermark.jpg"
      alt=""
      aria-hidden="true"
      className="global-simulation-watermark"
      width={560}
      height={560}
      priority={false}
      unoptimized
    />
  );
};

export default Watermark;
