// Block-native content model. Shared between the editor wrapper and the
// eventual server round-trip. Each concrete block variant carries a typed
// content shape and props bag so the DB row is self-describing.

export type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strikethrough?: boolean;
  link?: string;
};

export type TextBlockContent = { runs: InlineRun[] };

export type ParagraphBlock = {
  type: "paragraph";
  content: TextBlockContent;
  props: Record<string, never>;
};

export type HeadingBlock = {
  type: "heading";
  content: TextBlockContent;
  props: { level: 1 | 2 | 3 };
};

export type BulletBlock = {
  type: "bulletListItem";
  content: TextBlockContent;
  props: Record<string, never>;
};

export type NumberedBlock = {
  type: "numberedListItem";
  content: TextBlockContent;
  props: Record<string, never>;
};

export type CheckBlock = {
  type: "checkListItem";
  content: TextBlockContent;
  props: { checked: boolean };
};

export type QuoteBlock = {
  type: "quote";
  content: TextBlockContent;
  props: Record<string, never>;
};

// Later phases: code, callout, image, refEmbed, divider.
export type Block =
  | ParagraphBlock
  | HeadingBlock
  | BulletBlock
  | NumberedBlock
  | CheckBlock
  | QuoteBlock;

// DB envelope — matches the eventual `blocks` table row shape.
export type BlockRow<T extends Block = Block> = {
  id: string;
  docId: string;
  parentId: string | null;
  position: string;
  version: number;
  createdAt: string;
  updatedAt: string;
} & T;
