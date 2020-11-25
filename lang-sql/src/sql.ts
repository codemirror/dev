import {continuedIndent, indentNodeProp, foldNodeProp, LezerSyntax} from "@codemirror/next/syntax"
import {Parser} from "lezer"
import {Extension} from "@codemirror/next/state"
import {Completion} from "@codemirror/next/autocomplete"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {parser as baseParser} from "./sql.grammar"
import {tokens, Dialect, tokensFor, SQLKeywords, SQLTypes, dialect} from "./tokens"
import {completeFromSchema, completeKeywords} from "./complete"

let parser = baseParser.configure({
  props: [
    indentNodeProp.add({
      Statement: continuedIndent()
    }),
    foldNodeProp.add({
      Statement(tree) { return {from: tree.firstChild!.to, to: tree.to} },
      BlockComment(tree) { return {from: tree.from + 2, to: tree.to - 2} }
    }),
    styleTags({
      Keyword: t.keyword,
      Type: t.typeName,
      Builtin: t.standard(t.name),
      Bool: t.bool,
      Null: t.null,
      Number: t.number,
      String: t.string,
      Identifier: t.name,
      QuotedIdentifier: t.special(t.string),
      SpecialVar: t.special(t.name),
      LineComment: t.lineComment,
      BlockComment: t.blockComment,
      Operator: t.operator,
      "Semi Punctuation": t.punctuation,
      "( )": t.paren,
      "{ }": t.brace,
      "[ ]": t.squareBracket
    })
  ]
})

type SQLDialectSpec = {
  /// A space-separated list of keywords for the dialect.
  keywords?: string,
  /// A space-separated string of built-in identifiers for the dialect.
  builtin?: string,
  /// A space-separated string of type names for the dialect.
  types?: string,
  /// Controls whether regular strings allow backslash escapes.
  backslashEscapes?: boolean,
  /// Controls whether # creates a line comment.
  hashComments?: boolean,
  /// Controls whether `//` creates a line comment.
  slashComments?: boolean,
  /// When enabled `--` comments are only recognized when there's a
  /// space after the dashes.
  spaceAfterDashes?: boolean,
  /// When enabled, things quoted with double quotes are treated as
  /// strings, rather than identifiers.
  doubleQuotedStrings?: boolean,
  /// Enables strings like `_utf8'str'` or `N'str'`.
  charSetCasts?: boolean,
  /// The set of characters that make up operators. Defaults to
  /// `"*+\-%<>!=&|~^/"`.
  operatorChars?: string,
  /// The set of characters that start a special variable name.
  /// Defaults to `"?"`.
  specialVar?: string,
  /// The characters that can be used to quote identifiers. Defaults
  /// to `"\""`.
  identifierQuotes?: string
}

/// Represents an SQL dialect.
export class SQLDialect {
  /// @internal
  constructor(
    /// @internal
    readonly dialect: Dialect,
    /// The syntax for this dialect.
    readonly syntax: LezerSyntax<Parser>
  ) {}

  /// Returns the syntax for this dialect as an extension.
  get extension() { return this.syntax.extension }

  /// Define a new dialect.
  static define(spec: SQLDialectSpec) {
    let d = dialect(spec, spec.keywords, spec.types, spec.builtin)
    let syntax = LezerSyntax.define({
      parser: parser.configure({
        tokenizers: [{from: tokens, to: tokensFor(d)}]
      }),
      languageData: {
        commentTokens: {line: "--", block: {open: "/*", close: "*/"}},
        closeBrackets: {brackets: ["(", "[", "{", "'", '"', "`"]}
      }
    })
    return new SQLDialect(d, syntax)
  }
}

/// Options used to configure an SQL extension.
export type SQLConfig = {
  /// The [dialect](#lang-sql.SQLDialect) to use. Defaults to
  /// [`StandardSQL`](#lang-sql.StandardSQL).
  dialect?: SQLDialect,
  /// An object that maps table names to options (columns) that can
  /// be completed for that table. Use lower-case names here.
  schema?: {[table: string]: readonly (string | Completion)[]},
  /// By default, the completions for the table names will be
  /// generated from the `schema` object. But if you want to
  /// customize them, you can pass an array of completions through
  /// this option.
  tables?: readonly Completion[],
  /// When given, columns from the named table can be completed
  /// directly at the top level.
  defaultTable?: string
}

/// Returns an extension that enables keyword completion for the given
/// SQL dialect.
export function keywordCompletion(dialect: SQLDialect): Extension {
  return dialect.syntax.languageData.of({
    autocomplete: completeKeywords(dialect.dialect.words)
  })
}

/// Returns an extension that enables schema-based completion for the
/// given configuration.
export function schemaCompletion(config: SQLConfig): Extension {
  return config.schema ? (config.dialect || StandardSQL).syntax.languageData.of({
    autocomplete: completeFromSchema(config.schema, config.tables, config.defaultTable)
  }) : []
}

/// Returns an extension that installs SQL support features
/// (completion of keywords, and optionally
/// [schema-based](#lang-sql.SQLOptions.schema) completion).
export function sqlSupport(config: SQLConfig): Extension {
  return [schemaCompletion(config), keywordCompletion(config.dialect || StandardSQL)]
}

/// Produces an extension that installs the given SQL dialect syntax,
/// keyword completion, and, if provided, schema-based completion.
export function sql(config: SQLConfig): Extension {
  return [config.dialect || StandardSQL, sqlSupport(config)]
}

/// The standard SQL dialect.
export const StandardSQL = SQLDialect.define({})

/// Dialect for [PostgreSQL](https://www.postgresql.org).
export const PostgreSQL = SQLDialect.define({
  charSetCasts: true,
  operatorChars: "+-*/<>=~!@#%^&|`?",
  specialVar: "",
  keywords: SQLKeywords + "a abort abs absent access according ada admin aggregate alias also always analyse analyze array_agg array_max_cardinality asensitive assert assignment asymmetric atomic attach attribute attributes avg backward base64 begin_frame begin_partition bernoulli bit_length blocked bom c cache called cardinality catalog_name ceil ceiling chain char_length character_length character_set_catalog character_set_name character_set_schema characteristics characters checkpoint class class_origin cluster coalesce cobol collation_catalog collation_name collation_schema collect column_name columns command_function command_function_code comment comments committed concurrently condition_number configuration conflict connection_name constant constraint_catalog constraint_name constraint_schema contains content control conversion convert copy corr cost covar_pop covar_samp csv cume_dist current_catalog current_row current_schema cursor_name database datalink datatype datetime_interval_code datetime_interval_precision db debug defaults defined definer degree delimiter delimiters dense_rank depends derived detach detail dictionary disable discard dispatch dlnewcopy dlpreviouscopy dlurlcomplete dlurlcompleteonly dlurlcompletewrite dlurlpath dlurlpathonly dlurlpathwrite dlurlscheme dlurlserver dlvalue document dump dynamic_function dynamic_function_code element elsif empty enable encoding encrypted end_frame end_partition endexec enforced enum errcode error event every exclude excluding exclusive exp explain expression extension extract family file filter final first_value flag floor following force foreach fortran forward frame_row freeze fs functions fusion g generated granted greatest groups handler header hex hierarchy hint id ignore ilike immediately immutable implementation implicit import include including increment indent index indexes info inherit inherits inline insensitive instance instantiable instead integrity intersection invoker isnull k key_member key_type label lag last_value lead leakproof least length library like_regex link listen ln load location lock locked log logged lower m mapping matched materialized max max_cardinality maxvalue member merge message message_length message_octet_length message_text min minvalue mod mode more move multiset mumps name namespace nfc nfd nfkc nfkd nil normalize normalized nothing notice notify notnull nowait nth_value ntile nullable nullif nulls number occurrences_regex octet_length octets off offset oids operator options ordering others over overlay overriding owned owner p parallel parameter_mode parameter_name parameter_ordinal_position parameter_specific_catalog parameter_specific_name parameter_specific_schema parser partition pascal passing passthrough password percent percent_rank percentile_cont percentile_disc perform period permission pg_context pg_datatype_name pg_exception_context pg_exception_detail pg_exception_hint placing plans pli policy portion position position_regex power precedes preceding prepared print_strict_params procedural procedures program publication query quote raise range rank reassign recheck recovery refresh regr_avgx regr_avgy regr_count regr_intercept regr_r2 regr_slope regr_sxx regr_sxy regr_syy reindex rename repeatable replace replica requiring reset respect restart restore result_oid returned_cardinality returned_length returned_octet_length returned_sqlstate returning reverse routine_catalog routine_name routine_schema routines row_count row_number rowtype rule scale schema_name schemas scope scope_catalog scope_name scope_schema security selective self sensitive sequence sequences serializable server server_name setof share show simple skip slice snapshot source specific_name sqlcode sqlerror sqrt stable stacked standalone statement statistics stddev_pop stddev_samp stdin stdout storage strict strip structure style subclass_origin submultiset subscription substring substring_regex succeeds sum symmetric sysid system system_time t table_name tables tablesample tablespace temp template ties token top_level_count transaction_active transactions_committed transactions_rolled_back transform transforms translate translate_regex trigger_catalog trigger_name trigger_schema trim trim_array truncate trusted type types uescape unbounded uncommitted unencrypted unlink unlisten unlogged unnamed untyped upper uri use_column use_variable user_defined_type_catalog user_defined_type_code user_defined_type_name user_defined_type_schema vacuum valid validate validator value_of var_pop var_samp varbinary variable_conflict variadic verbose version versioning views volatile warning whitespace width_bucket window within wrapper xmlagg xmlattributes xmlbinary xmlcast xmlcomment xmlconcat xmldeclaration xmldocument xmlelement xmlexists xmlforest xmliterate xmlnamespaces xmlparse xmlpi xmlquery xmlroot xmlschema xmlserialize xmltable xmltext xmlvalidate yes",
  types: SQLTypes + "bigint int8 bigserial serial8 varbit bool box bytea cidr circle precision float8 inet int4 json jsonb line lseg macaddr macaddr8 money numeric path pg_lsn point polygon float4 int2 smallserial serial2 serial serial4 text without zone with timetz timestamptz tsquery tsvector txid_snapshot uuid xml"
})

const MySQLKeywords = "accessible algorithm analyze asensitive authors auto_increment autocommit avg avg_row_length binlog btree cache catalog_name chain change changed checkpoint checksum class_origin client_statistics coalesce code collations columns comment committed completion concurrent consistent contains contributors convert database databases day_hour day_microsecond day_minute day_second delay_key_write delayed delimiter des_key_file dev_pop dev_samp deviance directory disable discard distinctrow div dual dumpfile enable enclosed ends engine engines enum errors escaped even event events every explain extended fast field fields flush force found_rows fulltext grants handler hash high_priority hosts hour_microsecond hour_minute hour_second ignore ignore_server_ids import index index_statistics infile innodb insensitive insert_method install invoker iterate keys kill linear lines list load lock logs low_priority master master_heartbeat_period master_ssl_verify_server_cert masters max max_rows maxvalue message_text middleint migrate min min_rows minute_microsecond minute_second mod mode modify mutex mysql_errno no_write_to_binlog offline offset one online optimize optionally outfile pack_keys parser partition partitions password phase plugin plugins prev processlist profile profiles purge query quick range read_write rebuild recover regexp relaylog remove rename reorganize repair repeatable replace require resume rlike row_format rtree schedule schema_name schemas second_microsecond security sensitive separator serializable server share show slave slow snapshot soname spatial sql_big_result sql_buffer_result sql_cache sql_calc_found_rows sql_no_cache sql_small_result ssl starting starts std stddev stddev_pop stddev_samp storage straight_join subclass_origin sum suspend table_name table_statistics tables tablespace terminated triggers truncate uncommitted uninstall unlock upgrade use use_frm user_resources user_statistics utc_date utc_time utc_timestamp variables views warnings xa xor year_month zerofill"

const MySQLTypes = SQLTypes + "bool blob long longblob longtext medium mediumblob mediumint mediumtext tinyblob tinyint tinytext text bigint int1 int2 int3 int4 int8 float4 float8 varbinary varcharacter precision datetime year unsigned signed"

const MySQLBuiltin = "charset clear connect edit ego exit go help nopager notee nowarning pager print prompt quit rehash source status system tee"

/// [MySQL](https://dev.mysql.com/) dialect.
export const MySQL = SQLDialect.define({
  operatorChars: "*+-%<>!=&|^",
  charSetCasts: true,
  doubleQuotedStrings: true,
  hashComments: true,
  spaceAfterDashes: true,
  specialVar: "@?",
  identifierQuotes: "`",
  keywords: SQLKeywords + "group_concat " + MySQLKeywords,
  types: MySQLTypes,
  builtin: MySQLBuiltin
})

/// Variant of [`MySQL`](#lang-sql.MySQL) for
/// [MariaDB](https://mariadb.org/).
export const MariaSQL = SQLDialect.define({
  operatorChars: "*+-%<>!=&|^",
  charSetCasts: true,
  doubleQuotedStrings: true,
  hashComments: true,
  spaceAfterDashes: true,
  specialVar: "@?",
  identifierQuotes: "`",
  keywords: SQLKeywords + "always generated groupby_concat hard persistent shutdown soft virtual " + MySQLKeywords,
  types: MySQLTypes,
  builtin: MySQLBuiltin
})

/// SQL dialect for Microsoft [SQL
/// Server](https://www.microsoft.com/en-us/sql-server).
export const MSSQL = SQLDialect.define({
  keywords: SQLKeywords + "trigger proc view index for add constraint key primary foreign collate clustered nonclustered declare exec go if use index holdlock nolock nowait paglock pivot readcommitted readcommittedlock readpast readuncommitted repeatableread rowlock serializable snapshot tablock tablockx unpivot updlock with",
  types: SQLTypes + "bigint smallint smallmoney tinyint money real text nvarchar ntext varbinary image cursor hierarchyid uniqueidentifier sql_variant xml table",
  builtin: "binary_checksum checksum connectionproperty context_info current_request_id error_line error_message error_number error_procedure error_severity error_state formatmessage get_filestream_transaction_context getansinull host_id host_name isnull isnumeric min_active_rowversion newid newsequentialid rowcount_big xact_state object_id",
  operatorChars: "*+-%<>!=^&|/",
  specialVar: "@"
})

/// [SQLite](https://sqlite.org/) dialect.
export const SQLite = SQLDialect.define({
  keywords: SQLKeywords + "abort analyze attach autoincrement conflict database detach exclusive fail glob ignore index indexed instead isnull notnull offset plan pragma query raise regexp reindex rename replace temp vacuum virtual",
  types: SQLTypes + "bool blob long longblob longtext medium mediumblob mediumint mediumtext tinyblob tinyint tinytext text bigint int2 int8 year unsigned signed real",
  builtin: "auth backup bail binary changes check clone databases dbinfo dump echo eqp exit explain fullschema headers help import imposter indexes iotrace limit lint load log mode nullvalue once open output print prompt quit read restore save scanstats schema separator session shell show stats system tables testcase timeout timer trace vfsinfo vfslist vfsname width",
  operatorChars: "*+-%<>!=&|/~",
  identifierQuotes: "`\"",
  specialVar: "@:?$"
})

/// Dialect for [Cassandra](https://cassandra.apache.org/)'s SQL-ish query language.
export const Cassandra = SQLDialect.define({
  keywords: "add all allow alter and any apply as asc authorize batch begin by clustering columnfamily compact consistency count create custom delete desc distinct drop each_quorum exists filtering from grant if in index insert into key keyspace keyspaces level limit local_one local_quorum modify nan norecursive nosuperuser not of on one order password permission permissions primary quorum rename revoke schema select set storage superuser table three to token truncate ttl two type unlogged update use user users using values where with writetime infinity NaN",
  types: SQLTypes + "ascii bigint blob counter frozen inet list map static text timeuuid tuple uuid varint",
  slashComments: true
})

/// [PL/SQL](https://en.wikipedia.org/wiki/PL/SQL) dialect.
export const PLSQL = SQLDialect.define({
  keywords: SQLKeywords + "abort accept access add all alter and any array arraylen as asc assert assign at attributes audit authorization avg base_table begin between binary_integer body boolean by case cast char char_base check close cluster clusters colauth column comment commit compress connect connected constant constraint crash create current currval cursor data_base database date dba deallocate debugoff debugon decimal declare default definition delay delete desc digits dispose distinct do drop else elseif elsif enable end entry escape exception exception_init exchange exclusive exists exit external fast fetch file for force form from function generic goto grant group having identified if immediate in increment index indexes indicator initial initrans insert interface intersect into is key level library like limited local lock log logging long loop master maxextents maxtrans member minextents minus mislabel mode modify multiset new next no noaudit nocompress nologging noparallel not nowait number_base object of off offline on online only open option or order out package parallel partition pctfree pctincrease pctused pls_integer positive positiven pragma primary prior private privileges procedure public raise range raw read rebuild record ref references refresh release rename replace resource restrict return returning returns reverse revoke rollback row rowid rowlabel rownum rows run savepoint schema segment select separate session set share snapshot some space split sql start statement storage subtype successful synonym tabauth table tables tablespace task terminate then to trigger truncate type union unique unlimited unrecoverable unusable update use using validate value values variable view views when whenever where while with work",
  builtin: "appinfo arraysize autocommit autoprint autorecovery autotrace blockterminator break btitle cmdsep colsep compatibility compute concat copycommit copytypecheck define describe echo editfile embedded escape exec execute feedback flagger flush heading headsep instance linesize lno loboffset logsource long longchunksize markup native newpage numformat numwidth pagesize pause pno recsep recsepchar release repfooter repheader serveroutput shiftinout show showmode size spool sqlblanklines sqlcase sqlcode sqlcontinue sqlnumber sqlpluscompatibility sqlprefix sqlprompt sqlterminator suffix tab term termout time timing trimout trimspool ttitle underline verify version wrap",
  types: SQLTypes + "ascii bfile bfilename bigserial bit blob dec number nvarchar nvarchar2 serial smallint string text uid varchar2 xml",
  operatorChars: "*/+-%<>!=~",
  doubleQuotedStrings: true,
  charSetCasts: true
})
