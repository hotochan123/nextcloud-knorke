<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

/**
 * Builds an object implementing a Nextcloud interface whose methods are
 * closures, generated from reflection at run time. The signatures of OCP
 * interfaces drift between Nextcloud 34 and 35 (typed parameters added), so a
 * hand-written fake would only compile on one of them; this one follows the
 * running server. Methods without a closure return a neutral value (null,
 * [], '', 0, false) or throw for object return types.
 *
 * Fake::of(IConfig::class, ['getSystemValueBool' => fn (string $k, bool $d = false): bool => true]);
 * Fake::of(IRequest::class, [...], ['urlParams' => ['id' => '7']]);   // public properties
 */
final class Fake {
    /** @var array<string, string> generated class per interface + property set */
    private static array $classes = [];

    /**
     * @param class-string $iface
     * @param array<string, \Closure> $methods
     * @param array<string, mixed> $props public properties of the fake
     */
    public static function of(string $iface, array $methods = [], array $props = []): object {
        $sig = $iface . '|' . implode(',', array_keys($props));
        $cls = self::$classes[$sig] ??= self::generate($iface, array_keys($props));
        $o = new $cls();
        $o->__methods = $methods;
        foreach ($props as $k => $v) {
            $o->$k = $v;
        }
        return $o;
    }

    /** @param list<string> $props */
    private static function generate(string $iface, array $props): string {
        static $n = 0;
        $rc = new \ReflectionClass($iface);
        $cls = 'KnorkeFake' . (++$n) . '_' . $rc->getShortName();
        $code = 'final class ' . $cls . ' implements \\' . ltrim($iface, '\\') . " {\n    public array \$__methods = [];\n";
        foreach ($props as $p) {
            $code .= "    public mixed \$$p = null;\n";
        }
        foreach ($rc->getMethods() as $m) {
            $params = [];
            foreach ($m->getParameters() as $p) {
                $type = $p->hasType() ? self::type((string)$p->getType()) . ' ' : '';
                $default = '';
                if ($p->isDefaultValueAvailable()) {
                    $default = ' = ' . var_export($p->getDefaultValue(), true);
                } elseif ($p->isOptional() && !$p->isVariadic()) {
                    $default = ' = null';
                }
                $params[] = $type . ($p->isPassedByReference() ? '&' : '') . ($p->isVariadic() ? '...' : '') . '$' . $p->getName() . $default;
            }
            $rt = $m->hasReturnType() ? (string)$m->getReturnType() : '';
            $name = $m->getName();
            $static = $m->isStatic() ? 'static ' : '';
            $body = $m->isStatic()
                ? self::fallback($rt, $name)
                : "if (isset(\$this->__methods['$name'])) { " . ($rt === 'void' ? "(\$this->__methods['$name'])(...func_get_args()); return;" : "return (\$this->__methods['$name'])(...func_get_args());") . ' } ' . self::fallback($rt, $name);
            $code .= '    public ' . $static . 'function ' . $name . '(' . implode(', ', $params) . ')' . ($rt === '' ? '' : ': ' . self::type($rt)) . " { $body }\n";
        }
        $code .= "}\n";
        eval($code);
        return $cls;
    }

    /** Leading backslash for every class name in a type string. */
    private static function type(string $t): string {
        return preg_replace_callback('/(?<![\\\\A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*(?:\\\\[A-Za-z_][A-Za-z0-9_]*)*)/', static function (array $m): string {
            $builtin = ['int', 'float', 'string', 'bool', 'array', 'mixed', 'void', 'null', 'callable', 'iterable', 'object', 'false', 'true', 'never', 'self', 'static', 'parent'];
            return in_array(strtolower($m[1]), $builtin, true) ? $m[1] : '\\' . $m[1];
        }, $t) ?? $t;
    }

    private static function fallback(string $rt, string $name): string {
        $t = ltrim($rt, '?');
        return match (true) {
            $rt === 'void' => 'return;',
            $rt === 'never' => "throw new \\LogicException('$name');",
            $rt === '' || $rt === 'mixed' || str_starts_with($rt, '?') || str_contains($rt, 'null') => 'return null;',
            $t === 'array' || str_contains($rt, 'array') => 'return [];',
            $t === 'string' => "return '';",
            $t === 'int' => 'return 0;',
            $t === 'float' => 'return 0.0;',
            $t === 'bool' || $t === 'false' || str_contains($rt, 'bool') || str_contains($rt, 'false') => 'return false;',
            default => "throw new \\LogicException('Fake: no closure for $name');",
        };
    }
}
